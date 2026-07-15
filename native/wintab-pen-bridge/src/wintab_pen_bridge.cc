#include <node_api.h>

#include <windows.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <deque>
#include <string>
#include <unordered_map>
#include <vector>

namespace {

using WTPKT = UINT;
using HCTX = HANDLE;

struct FIX32 {
  WORD frac;
  short whole;
};

struct AXIS {
  LONG axMin;
  LONG axMax;
  UINT axUnits;
  FIX32 axResolution;
};

struct LOGCONTEXTW {
  WCHAR lcName[40];
  UINT lcOptions;
  UINT lcStatus;
  UINT lcLocks;
  UINT lcMsgBase;
  UINT lcDevice;
  UINT lcPktRate;
  WTPKT lcPktData;
  WTPKT lcPktMode;
  WTPKT lcMoveMask;
  DWORD lcBtnDnMask;
  DWORD lcBtnUpMask;
  LONG lcInOrgX;
  LONG lcInOrgY;
  LONG lcInOrgZ;
  LONG lcInExtX;
  LONG lcInExtY;
  LONG lcInExtZ;
  LONG lcOutOrgX;
  LONG lcOutOrgY;
  LONG lcOutOrgZ;
  LONG lcOutExtX;
  LONG lcOutExtY;
  LONG lcOutExtZ;
  FIX32 lcSensX;
  FIX32 lcSensY;
  FIX32 lcSensZ;
  BOOL lcSysMode;
  int lcSysOrgX;
  int lcSysOrgY;
  int lcSysExtX;
  int lcSysExtY;
  FIX32 lcSysSensX;
  FIX32 lcSysSensY;
};

struct PacketData {
  HCTX pkContext;
  UINT pkStatus;
  DWORD pkButtons;
  LONG pkX;
  LONG pkY;
  UINT pkNormalPressure;
};

constexpr UINT WTI_INTERFACE = 1;
constexpr UINT WTI_DEFSYSCTX = 4;
constexpr UINT WTI_DEVICES = 100;
constexpr UINT DVC_NPRESSURE = 15;

constexpr UINT CXO_MESSAGES = 0x0004;
constexpr UINT CXO_SYSTEM = 0x0001;

constexpr UINT WT_DEFBASE = 0x7FF0;
constexpr UINT WT_PACKET = 0;
constexpr DWORD TIP_CONTACT_BUTTON_MASK = 0x1U;
constexpr DWORD NON_TIP_BUTTON_MASK = ~TIP_CONTACT_BUTTON_MASK;

// WinTab can report tiny non-zero hover pressure values. Use hysteresis so
// pressure noise does not turn into synthetic pen clicks.
constexpr double CONTACT_START_PRESSURE = 0.01;
constexpr double CONTACT_END_PRESSURE = 0.005;
constexpr double CONTACT_CONFIRM_PRESSURE = 0.03;
constexpr ULONGLONG CONTACT_CONFIRMATION_MS = 12;
constexpr uint32_t CONTACT_CONFIRMATION_PACKET_COUNT = 2;
constexpr ULONGLONG RELEASE_CONFIRMATION_MS = 12;
constexpr uint32_t RELEASE_CONFIRMATION_PACKET_COUNT = 2;
constexpr ULONGLONG NON_TIP_BUTTON_PRESSURE_FREEZE_MS = 32;
constexpr ULONGLONG NON_TIP_BUTTON_COORDINATE_STABILIZATION_MS = 48;

constexpr WTPKT PK_CONTEXT = 0x0001;
constexpr WTPKT PK_STATUS = 0x0002;
constexpr WTPKT PK_BUTTONS = 0x0040;
constexpr WTPKT PK_X = 0x0080;
constexpr WTPKT PK_Y = 0x0100;
constexpr WTPKT PK_NORMAL_PRESSURE = 0x0400;

using WTInfoW_t = UINT(APIENTRY *)(UINT, UINT, LPVOID);
using WTOpenW_t = HCTX(APIENTRY *)(HWND, LOGCONTEXTW *, BOOL);
using WTClose_t = BOOL(APIENTRY *)(HCTX);
using WTPacketsGet_t = int(APIENTRY *)(HCTX, int, LPVOID);
using WTEnable_t = BOOL(APIENTRY *)(HCTX, BOOL);
using WTOverlap_t = BOOL(APIENTRY *)(HCTX, BOOL);

struct WinTabApi {
  HMODULE module = nullptr;
  WTInfoW_t WTInfoW = nullptr;
  WTOpenW_t WTOpenW = nullptr;
  WTClose_t WTClose = nullptr;
  WTPacketsGet_t WTPacketsGet = nullptr;
  WTEnable_t WTEnable = nullptr;
  WTOverlap_t WTOverlap = nullptr;
};

struct PenEvent {
  enum class Kind { Down, Move, Up };

  Kind kind;
  LONG screenX;
  LONG screenY;
  double pressure;
  DWORD buttons;
};

struct BridgeState {
  WinTabApi api;
  HWND hwnd = nullptr;
  HCTX context = nullptr;
  UINT msgBase = WT_DEFBASE;
  LONG pressureMin = 0;
  LONG pressureMax = 1023;
  bool systemContextRelative = false;
  LONG systemOrgX = 0;
  LONG systemOrgY = 0;
  LONG systemExtX = 0;
  LONG systemExtY = 0;
  bool packetAxisXResolved = false;
  bool packetAxisYResolved = false;
  bool packetFlipX = false;
  bool packetFlipY = false;
  LONG lastRawPacketX = 0;
  LONG lastRawPacketY = 0;
  LONG lastCursorCalibrationX = 0;
  LONG lastCursorCalibrationY = 0;
  bool hasLastCalibrationSample = false;
  int packetAxisXScore = 0;
  int packetAxisYScore = 0;
  bool attached = false;
  bool contactActive = false;
  bool pendingContact = false;
  bool pendingRelease = false;
  ULONGLONG suppressPrimaryMouseUntil = 0;
  LONG lastScreenX = 0;
  LONG lastScreenY = 0;
  double lastPressure = 0.0;
  DWORD lastButtons = 0;
  DWORD lastRawButtons = 0;
  ULONGLONG freezePressureUntil = 0;
  ULONGLONG useCursorCoordinatesUntil = 0;
  LONG pendingScreenX = 0;
  LONG pendingScreenY = 0;
  double pendingPressure = 0.0;
  DWORD pendingButtons = 0;
  ULONGLONG pendingSince = 0;
  uint32_t pendingSampleCount = 0;
  double pendingMaxPressure = 0.0;
  ULONGLONG releaseSince = 0;
  uint32_t releaseSampleCount = 0;
  std::wstring lastError;
  std::deque<PenEvent> queuedEvents;
  std::unordered_map<HWND, WNDPROC> hookedWindows;
};

BridgeState g_bridge;

void ProcessPacket(const PacketData &packet);

void SetLastErrorMessage(const std::wstring &message) {
  g_bridge.lastError = message;
}

bool EnsureWinTabLoaded() {
  if (g_bridge.api.module != nullptr) {
    return true;
  }

  HMODULE module = LoadLibraryW(L"Wintab32.dll");
  if (module == nullptr) {
    SetLastErrorMessage(L"Failed to load Wintab32.dll");
    return false;
  }

  auto loadProc = [module](auto &target, const char *name) -> bool {
    target = reinterpret_cast<std::remove_reference_t<decltype(target)>>(GetProcAddress(module, name));
    return target != nullptr;
  };

  if (!loadProc(g_bridge.api.WTInfoW, "WTInfoW") || !loadProc(g_bridge.api.WTOpenW, "WTOpenW") ||
      !loadProc(g_bridge.api.WTClose, "WTClose") || !loadProc(g_bridge.api.WTPacketsGet, "WTPacketsGet") ||
      !loadProc(g_bridge.api.WTEnable, "WTEnable") || !loadProc(g_bridge.api.WTOverlap, "WTOverlap")) {
    FreeLibrary(module);
    SetLastErrorMessage(L"Failed to load one or more WinTab entry points");
    return false;
  }

  g_bridge.api.module = module;
  return true;
}

double NormalizePressure(UINT pressure) {
  const auto range = static_cast<double>(std::max<LONG>(1, g_bridge.pressureMax - g_bridge.pressureMin));
  const auto normalized = (static_cast<double>(pressure) - static_cast<double>(g_bridge.pressureMin)) / range;
  return std::clamp(normalized, 0.0, 1.0);
}

bool SampleChanged(LONG screenX, LONG screenY, double pressure, DWORD buttons) {
  return screenX != g_bridge.lastScreenX || screenY != g_bridge.lastScreenY ||
         std::fabs(pressure - g_bridge.lastPressure) > 0.0001 || buttons != g_bridge.lastButtons;
}

void UpdateLastSample(LONG screenX, LONG screenY, double pressure, DWORD buttons) {
  g_bridge.lastScreenX = screenX;
  g_bridge.lastScreenY = screenY;
  g_bridge.lastPressure = pressure;
  g_bridge.lastButtons = buttons;
}

void ClearPendingContact() {
  g_bridge.pendingContact = false;
  g_bridge.pendingScreenX = 0;
  g_bridge.pendingScreenY = 0;
  g_bridge.pendingPressure = 0.0;
  g_bridge.pendingButtons = 0;
  g_bridge.pendingSince = 0;
  g_bridge.pendingSampleCount = 0;
  g_bridge.pendingMaxPressure = 0.0;
}

void ClearPendingRelease() {
  g_bridge.pendingRelease = false;
  g_bridge.releaseSince = 0;
  g_bridge.releaseSampleCount = 0;
}

void QueuePenEvent(PenEvent::Kind kind, LONG screenX, LONG screenY, double pressure, DWORD buttons) {
  g_bridge.queuedEvents.push_back(PenEvent{kind, screenX, screenY, pressure, buttons});
}

POINT ResolveCursorScreenPoint(const PacketData &packet) {
  POINT point{packet.pkX, packet.pkY};
  if (GetCursorPos(&point)) {
    return point;
  }
  return point;
}

bool IsPlausibleScreenPoint(const POINT &point) {
  const LONG left = GetSystemMetrics(SM_XVIRTUALSCREEN);
  const LONG top = GetSystemMetrics(SM_YVIRTUALSCREEN);
  const LONG right = left + GetSystemMetrics(SM_CXVIRTUALSCREEN);
  const LONG bottom = top + GetSystemMetrics(SM_CYVIRTUALSCREEN);
  constexpr LONG tolerance = 256;

  return point.x >= left - tolerance && point.x <= right + tolerance && point.y >= top - tolerance &&
         point.y <= bottom + tolerance;
}

LONG MirrorAxisInSystemSpace(const LONG value, const LONG origin, const LONG extent) {
  const auto absoluteExtent = std::llabs(static_cast<long long>(extent));
  if (absoluteExtent <= 0) {
    return value;
  }

  return static_cast<LONG>(static_cast<long long>(origin) + absoluteExtent -
                           (static_cast<long long>(value) - static_cast<long long>(origin)));
}

void UpdatePacketAxisCalibration(const PacketData &packet, const POINT &cursorPoint) {
  if (g_bridge.systemContextRelative) {
    return;
  }

  if (!g_bridge.hasLastCalibrationSample) {
    g_bridge.lastRawPacketX = packet.pkX;
    g_bridge.lastRawPacketY = packet.pkY;
    g_bridge.lastCursorCalibrationX = cursorPoint.x;
    g_bridge.lastCursorCalibrationY = cursorPoint.y;
    g_bridge.hasLastCalibrationSample = true;
    return;
  }

  const LONG packetDeltaX = packet.pkX - g_bridge.lastRawPacketX;
  const LONG packetDeltaY = packet.pkY - g_bridge.lastRawPacketY;
  const LONG cursorDeltaX = cursorPoint.x - g_bridge.lastCursorCalibrationX;
  const LONG cursorDeltaY = cursorPoint.y - g_bridge.lastCursorCalibrationY;

  constexpr LONG minimumDelta = 2;

  if (!g_bridge.packetAxisXResolved && std::llabs(static_cast<long long>(packetDeltaX)) >= minimumDelta &&
      std::llabs(static_cast<long long>(cursorDeltaX)) >= minimumDelta) {
    g_bridge.packetAxisXScore += (packetDeltaX > 0) == (cursorDeltaX > 0) ? 1 : -1;
    if (std::abs(g_bridge.packetAxisXScore) >= 3) {
      g_bridge.packetAxisXResolved = true;
      g_bridge.packetFlipX = g_bridge.packetAxisXScore < 0;
    }
  }

  if (!g_bridge.packetAxisYResolved && std::llabs(static_cast<long long>(packetDeltaY)) >= minimumDelta &&
      std::llabs(static_cast<long long>(cursorDeltaY)) >= minimumDelta) {
    g_bridge.packetAxisYScore += (packetDeltaY > 0) == (cursorDeltaY > 0) ? 1 : -1;
    if (std::abs(g_bridge.packetAxisYScore) >= 3) {
      g_bridge.packetAxisYResolved = true;
      g_bridge.packetFlipY = g_bridge.packetAxisYScore < 0;
    }
  }

  g_bridge.lastRawPacketX = packet.pkX;
  g_bridge.lastRawPacketY = packet.pkY;
  g_bridge.lastCursorCalibrationX = cursorPoint.x;
  g_bridge.lastCursorCalibrationY = cursorPoint.y;
}

POINT ResolvePacketScreenPoint(const PacketData &packet) {
  const POINT cursorPoint = ResolveCursorScreenPoint(packet);
  const auto now = GetTickCount64();

  if (now <= g_bridge.useCursorCoordinatesUntil) {
    g_bridge.lastRawPacketX = packet.pkX;
    g_bridge.lastRawPacketY = packet.pkY;
    g_bridge.lastCursorCalibrationX = cursorPoint.x;
    g_bridge.lastCursorCalibrationY = cursorPoint.y;
    g_bridge.hasLastCalibrationSample = true;
    return cursorPoint;
  }

  UpdatePacketAxisCalibration(packet, cursorPoint);

  if (g_bridge.systemContextRelative) {
    return cursorPoint;
  }

  POINT point{packet.pkX, packet.pkY};

  if (g_bridge.packetAxisXResolved && g_bridge.packetFlipX) {
    point.x = MirrorAxisInSystemSpace(point.x, g_bridge.systemOrgX, g_bridge.systemExtX);
  }

  if (g_bridge.packetAxisYResolved && g_bridge.packetFlipY) {
    point.y = MirrorAxisInSystemSpace(point.y, g_bridge.systemOrgY, g_bridge.systemExtY);
  }

  if (IsPlausibleScreenPoint(point)) {
    return point;
  }

  return cursorPoint;
}

bool IsPointerMessage(const UINT message) {
  switch (message) {
    case WM_POINTERDOWN:
    case WM_POINTERUP:
    case WM_POINTERUPDATE:
    case WM_POINTERENTER:
    case WM_POINTERLEAVE:
    case WM_POINTERACTIVATE:
    case WM_POINTERCAPTURECHANGED:
    case WM_POINTERWHEEL:
    case WM_POINTERHWHEEL:
      return true;
    default:
      return false;
  }
}

bool ShouldSuppressPenPointerMessage(const UINT message, const WPARAM wParam) {
  if (!IsPointerMessage(message)) {
    return false;
  }

  const UINT32 pointerId = GET_POINTERID_WPARAM(wParam);
  POINTER_INPUT_TYPE pointerType = PT_POINTER;
  if (!GetPointerType(pointerId, &pointerType)) {
    return false;
  }

  return pointerType == PT_PEN;
}

bool ShouldSuppressPrimaryMousePathNow() {
  return g_bridge.contactActive || g_bridge.pendingContact || GetTickCount64() <= g_bridge.suppressPrimaryMouseUntil;
}

bool ShouldSuppressPrimaryMouseMessage(const UINT message) {
  if (!ShouldSuppressPrimaryMousePathNow()) {
    return false;
  }

  switch (message) {
    case WM_LBUTTONDOWN:
    case WM_LBUTTONUP:
    case WM_LBUTTONDBLCLK:
    case WM_MOUSEMOVE:
      return true;
    default:
      return false;
  }
}

void ProcessQueuedPackets() {
  if (g_bridge.context == nullptr) {
    return;
  }

  PacketData packets[32];
  const int packetCount = g_bridge.api.WTPacketsGet(g_bridge.context, 32, packets);
  for (int index = 0; index < packetCount; ++index) {
    ProcessPacket(packets[index]);
  }
}

void ProcessPacket(const PacketData &packet) {
  const DWORD rawButtons = packet.pkButtons;
  const DWORD penButtons = rawButtons & TIP_CONTACT_BUTTON_MASK;
  const bool nonTipButtonStateChanged = ((rawButtons ^ g_bridge.lastRawButtons) & NON_TIP_BUTTON_MASK) != 0;
  const auto now = GetTickCount64();
  auto pressure = NormalizePressure(packet.pkNormalPressure);
  const bool tipContact = (penButtons & TIP_CONTACT_BUTTON_MASK) != 0;
  if (g_bridge.contactActive && nonTipButtonStateChanged) {
    g_bridge.freezePressureUntil = now + NON_TIP_BUTTON_PRESSURE_FREEZE_MS;
  }
  if (nonTipButtonStateChanged || (rawButtons & NON_TIP_BUTTON_MASK) != 0) {
    g_bridge.useCursorCoordinatesUntil = now + NON_TIP_BUTTON_COORDINATE_STABILIZATION_MS;
    g_bridge.hasLastCalibrationSample = false;
  }
  if (g_bridge.contactActive && now <= g_bridge.freezePressureUntil) {
    pressure = g_bridge.lastPressure;
  }
  const bool pressureContact =
      g_bridge.contactActive ? pressure > CONTACT_END_PRESSURE : pressure >= CONTACT_START_PRESSURE;
  const bool contact = tipContact || pressureContact;
  const POINT cursorPoint = ResolvePacketScreenPoint(packet);
  g_bridge.lastRawButtons = rawButtons;

  if (!g_bridge.contactActive && !g_bridge.pendingContact && contact) {
    g_bridge.pendingContact = true;
    g_bridge.pendingSince = now;
    g_bridge.pendingScreenX = cursorPoint.x;
    g_bridge.pendingScreenY = cursorPoint.y;
    g_bridge.pendingPressure = pressure;
    g_bridge.pendingButtons = penButtons;
    g_bridge.pendingSampleCount = 1;
    g_bridge.pendingMaxPressure = pressure;
    return;
  }

  if (!g_bridge.contactActive && g_bridge.pendingContact) {
    if (!contact) {
      ClearPendingContact();
      return;
    }

    g_bridge.pendingScreenX = cursorPoint.x;
    g_bridge.pendingScreenY = cursorPoint.y;
    g_bridge.pendingPressure = pressure;
    g_bridge.pendingButtons = penButtons;
    g_bridge.pendingSampleCount += 1;
    g_bridge.pendingMaxPressure = std::max(g_bridge.pendingMaxPressure, pressure);

    const bool confirmedByTip = tipContact;
    const bool confirmedByPressure = g_bridge.pendingSampleCount >= CONTACT_CONFIRMATION_PACKET_COUNT &&
                                     g_bridge.pendingMaxPressure >= CONTACT_CONFIRM_PRESSURE &&
                                     now - g_bridge.pendingSince >= CONTACT_CONFIRMATION_MS;
    const bool confirmed = confirmedByTip || confirmedByPressure;
    if (!confirmed) {
      return;
    }

    g_bridge.contactActive = true;
    g_bridge.pendingContact = false;
    g_bridge.suppressPrimaryMouseUntil = 0;
    UpdateLastSample(
        g_bridge.pendingScreenX, g_bridge.pendingScreenY, g_bridge.pendingPressure, g_bridge.pendingButtons);
    QueuePenEvent(
        PenEvent::Kind::Down, g_bridge.pendingScreenX, g_bridge.pendingScreenY, g_bridge.pendingPressure,
        g_bridge.pendingButtons);
    ClearPendingContact();

    if (SampleChanged(cursorPoint.x, cursorPoint.y, pressure, penButtons)) {
      UpdateLastSample(cursorPoint.x, cursorPoint.y, pressure, penButtons);
      QueuePenEvent(PenEvent::Kind::Move, cursorPoint.x, cursorPoint.y, pressure, penButtons);
    }
    return;
  }

  if (g_bridge.contactActive && contact) {
    ClearPendingRelease();
    if (SampleChanged(cursorPoint.x, cursorPoint.y, pressure, penButtons)) {
      UpdateLastSample(cursorPoint.x, cursorPoint.y, pressure, penButtons);
      QueuePenEvent(PenEvent::Kind::Move, cursorPoint.x, cursorPoint.y, pressure, penButtons);
    }
    return;
  }

  if (g_bridge.contactActive && !contact) {
    if (!g_bridge.pendingRelease) {
      g_bridge.pendingRelease = true;
      g_bridge.releaseSince = now;
      g_bridge.releaseSampleCount = 1;
      return;
    }

    g_bridge.releaseSampleCount += 1;
    const bool confirmed =
        now - g_bridge.releaseSince >= RELEASE_CONFIRMATION_MS ||
        g_bridge.releaseSampleCount >= RELEASE_CONFIRMATION_PACKET_COUNT;
    if (!confirmed) {
      return;
    }

    g_bridge.contactActive = false;
    ClearPendingRelease();
    g_bridge.suppressPrimaryMouseUntil = GetTickCount64() + 200;
    UpdateLastSample(cursorPoint.x, cursorPoint.y, 0.0, penButtons);
    QueuePenEvent(PenEvent::Kind::Up, cursorPoint.x, cursorPoint.y, 0.0, penButtons);
  }
}

bool HookWindow(HWND hwnd);

BOOL CALLBACK HookChildWindowProc(HWND hwnd, LPARAM) {
  HookWindow(hwnd);
  return TRUE;
}

void HookWindowTree(HWND hwnd) {
  if (hwnd == nullptr || !IsWindow(hwnd)) {
    return;
  }

  HookWindow(hwnd);
  EnumChildWindows(hwnd, HookChildWindowProc, 0);
}

LRESULT CallOriginalWindowProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
  const auto iterator = g_bridge.hookedWindows.find(hwnd);
  if (iterator != g_bridge.hookedWindows.end() && iterator->second != nullptr) {
    return CallWindowProcW(iterator->second, hwnd, message, wParam, lParam);
  }

  return DefWindowProcW(hwnd, message, wParam, lParam);
}

LRESULT CALLBACK HookWndProc(HWND hwnd, UINT message, WPARAM wParam, LPARAM lParam) {
  if (g_bridge.attached) {
    if (message == g_bridge.msgBase + WT_PACKET || IsPointerMessage(message) || ShouldSuppressPrimaryMouseMessage(message)) {
      ProcessQueuedPackets();
    }

    if (message == WM_PARENTNOTIFY && LOWORD(wParam) == WM_CREATE) {
      const auto childHwnd = reinterpret_cast<HWND>(lParam);
      HookWindowTree(childHwnd);
    }

    if (ShouldSuppressPenPointerMessage(message, wParam) || ShouldSuppressPrimaryMouseMessage(message)) {
      return 0;
    }
  }

  const LRESULT result = CallOriginalWindowProc(hwnd, message, wParam, lParam);

  if (message == WM_NCDESTROY) {
    g_bridge.hookedWindows.erase(hwnd);
    if (hwnd == g_bridge.hwnd) {
      g_bridge.hwnd = nullptr;
    }
  }

  return result;
}

bool HookWindow(HWND hwnd) {
  if (hwnd == nullptr || !IsWindow(hwnd)) {
    return false;
  }

  if (g_bridge.hookedWindows.contains(hwnd)) {
    return true;
  }

  SetLastError(0);
  const auto previousProc = reinterpret_cast<WNDPROC>(
      SetWindowLongPtrW(hwnd, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(HookWndProc)));
  if (previousProc == nullptr && GetLastError() != 0) {
    return false;
  }

  g_bridge.hookedWindows.emplace(hwnd, previousProc);
  return true;
}

void DetachInternal() {
  if (g_bridge.context != nullptr) {
    g_bridge.api.WTClose(g_bridge.context);
    g_bridge.context = nullptr;
  }

  std::vector<std::pair<HWND, WNDPROC>> hookedWindows(g_bridge.hookedWindows.begin(), g_bridge.hookedWindows.end());
  for (const auto &[hwnd, originalProc] : hookedWindows) {
    if (hwnd != nullptr && originalProc != nullptr && IsWindow(hwnd)) {
      SetWindowLongPtrW(hwnd, GWLP_WNDPROC, reinterpret_cast<LONG_PTR>(originalProc));
    }
  }
  g_bridge.hookedWindows.clear();

  g_bridge.hwnd = nullptr;
  g_bridge.attached = false;
  g_bridge.contactActive = false;
  ClearPendingContact();
  ClearPendingRelease();
  g_bridge.suppressPrimaryMouseUntil = 0;
  g_bridge.lastPressure = 0.0;
  g_bridge.lastButtons = 0;
  g_bridge.lastRawButtons = 0;
  g_bridge.freezePressureUntil = 0;
  g_bridge.useCursorCoordinatesUntil = 0;
  g_bridge.packetAxisXResolved = false;
  g_bridge.packetAxisYResolved = false;
  g_bridge.packetFlipX = false;
  g_bridge.packetFlipY = false;
  g_bridge.hasLastCalibrationSample = false;
  g_bridge.packetAxisXScore = 0;
  g_bridge.packetAxisYScore = 0;
  g_bridge.queuedEvents.clear();
}

bool AttachInternal(HWND hwnd) {
  if (hwnd == nullptr) {
    SetLastErrorMessage(L"Invalid window handle");
    return false;
  }

  if (!EnsureWinTabLoaded()) {
    return false;
  }

  if (g_bridge.attached) {
    DetachInternal();
  }

  LOGCONTEXTW context{};
  const UINT size = g_bridge.api.WTInfoW(WTI_DEFSYSCTX, 0, &context);
  if (size == 0) {
    SetLastErrorMessage(L"WTInfoW(WTI_DEFSYSCTX) failed");
    return false;
  }

  context.lcOptions |= CXO_SYSTEM | CXO_MESSAGES;
  context.lcSysMode = FALSE;
  context.lcMsgBase = WT_DEFBASE;
  context.lcPktData = PK_CONTEXT | PK_STATUS | PK_BUTTONS | PK_X | PK_Y | PK_NORMAL_PRESSURE;
  context.lcPktMode = 0;
  context.lcMoveMask = context.lcPktData;
  context.lcBtnDnMask = 0xFFFFFFFFu;
  context.lcBtnUpMask = 0xFFFFFFFFu;

  AXIS pressureAxis{};
  if (g_bridge.api.WTInfoW(WTI_DEVICES + context.lcDevice, DVC_NPRESSURE, &pressureAxis) != 0) {
    g_bridge.pressureMin = pressureAxis.axMin;
    g_bridge.pressureMax = pressureAxis.axMax;
  } else {
    g_bridge.pressureMin = 0;
    g_bridge.pressureMax = 1023;
  }

  const HCTX hctx = g_bridge.api.WTOpenW(hwnd, &context, TRUE);
  if (hctx == nullptr) {
    SetLastErrorMessage(L"WTOpenW failed");
    return false;
  }

  HookWindowTree(hwnd);
  if (!g_bridge.hookedWindows.contains(hwnd)) {
    g_bridge.api.WTClose(hctx);
    SetLastErrorMessage(L"Failed to subclass the target window");
    return false;
  }

  g_bridge.hwnd = hwnd;
  g_bridge.context = hctx;
  g_bridge.msgBase = context.lcMsgBase;
  g_bridge.systemContextRelative = context.lcSysMode != FALSE;
  g_bridge.systemOrgX = context.lcSysOrgX;
  g_bridge.systemOrgY = context.lcSysOrgY;
  g_bridge.systemExtX = context.lcSysExtX;
  g_bridge.systemExtY = context.lcSysExtY;
  g_bridge.packetAxisXResolved = false;
  g_bridge.packetAxisYResolved = false;
  g_bridge.packetFlipX = false;
  g_bridge.packetFlipY = false;
  g_bridge.hasLastCalibrationSample = false;
  g_bridge.packetAxisXScore = 0;
  g_bridge.packetAxisYScore = 0;
  g_bridge.attached = true;
  g_bridge.contactActive = false;
  ClearPendingContact();
  ClearPendingRelease();
  g_bridge.suppressPrimaryMouseUntil = 0;
  g_bridge.lastPressure = 0.0;
  g_bridge.lastButtons = 0;
  g_bridge.lastRawButtons = 0;
  g_bridge.freezePressureUntil = 0;
  g_bridge.useCursorCoordinatesUntil = 0;
  g_bridge.queuedEvents.clear();

  g_bridge.api.WTEnable(g_bridge.context, TRUE);
  g_bridge.api.WTOverlap(g_bridge.context, TRUE);
  SetLastErrorMessage(L"");
  return true;
}

napi_value CreateBoolean(napi_env env, bool value) {
  napi_value result;
  napi_get_boolean(env, value, &result);
  return result;
}

napi_value CreateInt32(napi_env env, int32_t value) {
  napi_value result;
  napi_create_int32(env, value, &result);
  return result;
}

napi_value CreateDouble(napi_env env, double value) {
  napi_value result;
  napi_create_double(env, value, &result);
  return result;
}

napi_value CreateString(napi_env env, const std::wstring &value) {
  napi_value result;
  napi_create_string_utf16(env, reinterpret_cast<const char16_t *>(value.c_str()), value.size(), &result);
  return result;
}

napi_value IsSupported(napi_env env, napi_callback_info info) {
  (void)info;
  return CreateBoolean(env, EnsureWinTabLoaded());
}

napi_value Attach(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);

  if (argc != 1) {
    napi_throw_type_error(env, nullptr, "attach() expects a native window handle Buffer");
    return nullptr;
  }

  bool isBuffer = false;
  napi_is_buffer(env, args[0], &isBuffer);
  if (!isBuffer) {
    napi_throw_type_error(env, nullptr, "attach() expects a native window handle Buffer");
    return nullptr;
  }

  void *data = nullptr;
  size_t length = 0;
  napi_get_buffer_info(env, args[0], &data, &length);
  if (length < sizeof(void *)) {
    napi_throw_type_error(env, nullptr, "Native window handle Buffer is too small");
    return nullptr;
  }

  auto hwnd = *reinterpret_cast<HWND *>(data);
  const bool attached = AttachInternal(hwnd);

  napi_value result;
  napi_create_object(env, &result);
  napi_set_named_property(env, result, "attached", CreateBoolean(env, attached));
  napi_set_named_property(env, result, "contactActive", CreateBoolean(env, g_bridge.contactActive));
  napi_set_named_property(env, result, "pressureMin", CreateInt32(env, g_bridge.pressureMin));
  napi_set_named_property(env, result, "pressureMax", CreateInt32(env, g_bridge.pressureMax));
  napi_set_named_property(env, result, "lastError", CreateString(env, g_bridge.lastError));
  return result;
}

napi_value Detach(napi_env env, napi_callback_info info) {
  (void)info;
  DetachInternal();
  return nullptr;
}

napi_value DrainEvents(napi_env env, napi_callback_info info) {
  (void)info;

  napi_value result;
  napi_create_array_with_length(env, g_bridge.queuedEvents.size(), &result);

  uint32_t index = 0;
  while (!g_bridge.queuedEvents.empty()) {
    const auto event = g_bridge.queuedEvents.front();
    g_bridge.queuedEvents.pop_front();

    napi_value item;
    napi_create_object(env, &item);

    const char *kind = "move";
    if (event.kind == PenEvent::Kind::Down) {
      kind = "down";
    } else if (event.kind == PenEvent::Kind::Up) {
      kind = "up";
    }

    napi_value kindValue;
    napi_create_string_utf8(env, kind, NAPI_AUTO_LENGTH, &kindValue);
    napi_set_named_property(env, item, "kind", kindValue);
    napi_set_named_property(env, item, "screenX", CreateInt32(env, event.screenX));
    napi_set_named_property(env, item, "screenY", CreateInt32(env, event.screenY));
    napi_set_named_property(env, item, "pressure", CreateDouble(env, event.pressure));
    napi_set_named_property(env, item, "buttons", CreateInt32(env, static_cast<int32_t>(event.buttons)));
    napi_set_element(env, result, index++, item);
  }

  return result;
}

napi_value GetStatus(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value result;
  napi_create_object(env, &result);
  napi_set_named_property(env, result, "attached", CreateBoolean(env, g_bridge.attached));
  napi_set_named_property(env, result, "contactActive", CreateBoolean(env, g_bridge.contactActive));
  napi_set_named_property(env, result, "pressureMin", CreateInt32(env, g_bridge.pressureMin));
  napi_set_named_property(env, result, "pressureMax", CreateInt32(env, g_bridge.pressureMax));
  napi_set_named_property(env, result, "lastError", CreateString(env, g_bridge.lastError));
  return result;
}

napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor descriptors[] = {
      {"isSupported", nullptr, IsSupported, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"attach", nullptr, Attach, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"detach", nullptr, Detach, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"drainEvents", nullptr, DrainEvents, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"getStatus", nullptr, GetStatus, nullptr, nullptr, nullptr, napi_default, nullptr},
  };

  napi_define_properties(env, exports, sizeof(descriptors) / sizeof(descriptors[0]), descriptors);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)


