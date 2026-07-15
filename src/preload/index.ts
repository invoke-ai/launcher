import { exposeElectronAPI } from '@electron-toolkit/preload';
import { ipcRenderer } from 'electron';

const IS_INVOKE_HOSTED_WINDOW = process.argv.includes('--invoke-hosted-window');
const WINTAB_STATUS_CHANNEL = 'invoke-window:wintab-status';
const WINTAB_EVENT_CHANNEL = 'invoke-window:wintab-pen-event';
const SYNTHETIC_POINTER_ID = 424242;
const SUPPRESS_PRIMARY_MOUSE_GRACE_MS = 200;

type WinTabStatusPayload = {
  enabled: boolean;
  message: string;
};

type WinTabPenEventPayload = {
  kind: 'down' | 'move' | 'up';
  clientX: number;
  clientY: number;
  screenX: number;
  screenY: number;
  pressure: number;
  buttons: number;
};

if (IS_INVOKE_HOSTED_WINDOW) {
  setupInvokeWindowWinTabBridge();
} else {
  exposeElectronAPI();
}

function setupInvokeWindowWinTabBridge() {
  let bridgeEnabled = false;
  let suppressionInstalled = false;
  let mouseTrackingInstalled = false;
  let syntheticPenSessionActive = false;
  let syntheticMouseSessionActive = false;
  let suppressPrimaryMouseUntil = 0;
  let activeTarget: EventTarget | null = null;
  let dispatchingSyntheticMouseEvent = false;
  let activeAuxMouseButtons = 0;

  const stopEvent = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const isSyntheticWinTabPointerEvent = (event: Event) => {
    return event instanceof PointerEvent && event.pointerId === SYNTHETIC_POINTER_ID && event.pointerType === 'pen';
  };

  const hasPrimaryButton = (event: MouseEvent | PointerEvent) => {
    if (event.type === 'mouseup' || event.type === 'pointerup') {
      return true;
    }

    if (event.button === 0) {
      return true;
    }

    return (event.buttons & 1) === 1;
  };

  const hasNonPrimaryButton = (event: MouseEvent | PointerEvent) => {
    if (event.button === 1 || event.button === 2) {
      return true;
    }

    return (event.buttons & ~1) !== 0;
  };

  const shouldSuppressNativeEvent = (event: Event) => {
    if (!bridgeEnabled) {
      return false;
    }

    if (dispatchingSyntheticMouseEvent) {
      return false;
    }

    if (isSyntheticWinTabPointerEvent(event)) {
      return false;
    }

    if (event instanceof PointerEvent && event.pointerType === 'pen') {
      return true;
    }

    if (syntheticPenSessionActive) {
      if (event instanceof PointerEvent && event.pointerType === 'mouse') {
        return hasNonPrimaryButton(event);
      }

      if (event instanceof MouseEvent) {
        return hasNonPrimaryButton(event);
      }
    }

    const now = performance.now();
    if (!syntheticPenSessionActive && now > suppressPrimaryMouseUntil) {
      return false;
    }

    if (event instanceof PointerEvent && event.pointerType === 'mouse') {
      return hasPrimaryButton(event);
    }

    if (event instanceof MouseEvent) {
      return hasPrimaryButton(event);
    }

    return false;
  };

  const suppressionHandler = (event: Event) => {
    if (shouldSuppressNativeEvent(event)) {
      stopEvent(event);
    }
  };

  const installSuppression = () => {
    if (suppressionInstalled) {
      return;
    }

    suppressionInstalled = true;
    const pointerEvents = [
      'pointerdown',
      'pointermove',
      'pointerup',
      'pointerenter',
      'pointerleave',
      'pointerover',
      'pointerout',
      'pointercancel',
      'mousedown',
      'mousemove',
      'mouseup',
      'click',
      'auxclick',
      'contextmenu',
    ];

    for (const eventType of pointerEvents) {
      window.addEventListener(eventType, suppressionHandler, true);
    }
  };

  const dispatchSyntheticPointer = (target: EventTarget, eventType: string, payload: WinTabPenEventPayload) => {
    if (!(target instanceof Element || target instanceof Document || target instanceof Window)) {
      return;
    }

    const event = new PointerEvent(eventType, {
      pointerId: SYNTHETIC_POINTER_ID,
      pointerType: 'pen',
      isPrimary: true,
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: payload.clientX,
      clientY: payload.clientY,
      screenX: payload.screenX,
      screenY: payload.screenY,
      pressure: payload.kind === 'up' ? 0 : payload.pressure,
      button: payload.kind === 'move' ? -1 : 0,
      buttons: payload.kind === 'up' ? 0 : 1,
      width: 1,
      height: 1,
    });

    target.dispatchEvent(event);
  };

  const dispatchSyntheticMouse = (
    target: EventTarget,
    eventType: 'mousedown' | 'mousemove' | 'mouseup' | 'click',
    payload: WinTabPenEventPayload
  ) => {
    if (!(target instanceof Element || target instanceof Document || target instanceof Window)) {
      return;
    }

    const buttons = eventType === 'mouseup' || eventType === 'click' ? 0 : 1;
    const event = new MouseEvent(eventType, {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: payload.clientX,
      clientY: payload.clientY,
      screenX: payload.screenX,
      screenY: payload.screenY,
      button: 0,
      buttons,
      detail: eventType === 'click' ? 1 : 0,
    });

    dispatchingSyntheticMouseEvent = true;
    try {
      target.dispatchEvent(event);
    } finally {
      dispatchingSyntheticMouseEvent = false;
    }
  };

  const buildPayloadFromMouseEvent = (event: MouseEvent): WinTabPenEventPayload => ({
    kind: 'up',
    clientX: event.clientX,
    clientY: event.clientY,
    screenX: event.screenX,
    screenY: event.screenY,
    pressure: 0,
    buttons: 0,
  });

  const getElementTarget = (target: EventTarget | null): Element | null => {
    return target instanceof Element ? target : null;
  };

  const getCurrentHoverTarget = (payload: WinTabPenEventPayload) => {
    return document.elementFromPoint(payload.clientX, payload.clientY) ?? activeTarget ?? document.body;
  };

  const isSyntheticMouseTarget = (target: EventTarget | null) => {
    const element = getElementTarget(target);
    if (!element) {
      return false;
    }

    if (element instanceof HTMLCanvasElement) {
      return false;
    }

    return Boolean(
      element.closest(
        [
          'button',
          'a[href]',
          'input',
          'select',
          'textarea',
          'label',
          'summary',
          '[role="button"]',
          '[role="link"]',
          '[role="checkbox"]',
          '[role="radio"]',
          '[role="switch"]',
          '[role="tab"]',
          '[role="menuitem"]',
          '[role="option"]',
          '[role="slider"]',
          '[contenteditable="true"]',
        ].join(',')
      )
    );
  };

  const dismissTransientUi = (payload: WinTabPenEventPayload) => {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && activeElement !== document.body) {
      activeElement.blur();
    }

    const dismissTarget = document.body ?? document.documentElement;
    if (dismissTarget) {
      const mouseDown = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: payload.clientX,
        clientY: payload.clientY,
        screenX: payload.screenX,
        screenY: payload.screenY,
        button: 0,
        buttons: 1,
        detail: 1,
      });
      const mouseUp = new MouseEvent('mouseup', {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: payload.clientX,
        clientY: payload.clientY,
        screenX: payload.screenX,
        screenY: payload.screenY,
        button: 0,
        buttons: 0,
        detail: 1,
      });
      const click = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: payload.clientX,
        clientY: payload.clientY,
        screenX: payload.screenX,
        screenY: payload.screenY,
        button: 0,
        buttons: 0,
        detail: 1,
      });

      dispatchingSyntheticMouseEvent = true;
      try {
        dismissTarget.dispatchEvent(mouseDown);
        dismissTarget.dispatchEvent(mouseUp);
        dismissTarget.dispatchEvent(click);
      } finally {
        dispatchingSyntheticMouseEvent = false;
      }
    }
  };

  const resolveClickTarget = (currentTarget: EventTarget | null) => {
    const downTarget = getElementTarget(activeTarget);
    const upTarget = getElementTarget(currentTarget);

    if (!downTarget) {
      return currentTarget;
    }

    if (!upTarget) {
      return downTarget;
    }

    if (downTarget === upTarget || downTarget.contains(upTarget) || upTarget.contains(downTarget)) {
      return downTarget;
    }

    return null;
  };

  const getDispatchTarget = (payload: WinTabPenEventPayload) => {
    if (payload.kind === 'up' && activeTarget) {
      return activeTarget;
    }

    return getCurrentHoverTarget(payload);
  };

  const endSyntheticPenSession = (payload: WinTabPenEventPayload) => {
    if (!syntheticPenSessionActive) {
      activeTarget = null;
      syntheticMouseSessionActive = false;
      return;
    }

    const upTarget = getCurrentHoverTarget(payload);
    const pointerTarget = activeTarget ?? upTarget;
    const clickTarget = syntheticMouseSessionActive ? resolveClickTarget(upTarget) : null;

    dispatchSyntheticPointer(pointerTarget, 'pointerup', payload);
    if (syntheticMouseSessionActive) {
      dispatchSyntheticMouse(pointerTarget, 'mouseup', payload);
    }
    if (clickTarget) {
      dispatchSyntheticMouse(clickTarget, 'click', payload);
    }

    activeTarget = null;
    syntheticPenSessionActive = false;
    syntheticMouseSessionActive = false;
    suppressPrimaryMouseUntil = performance.now() + SUPPRESS_PRIMARY_MOUSE_GRACE_MS;
  };

  const updateAuxMouseState = (event: MouseEvent) => {
    activeAuxMouseButtons = event.buttons & ~1;

    if (dispatchingSyntheticMouseEvent || event.button === 0 || !syntheticPenSessionActive) {
      return;
    }

    endSyntheticPenSession(buildPayloadFromMouseEvent(event));
  };

  const installMouseButtonTracking = () => {
    if (mouseTrackingInstalled) {
      return;
    }

    mouseTrackingInstalled = true;
    const mouseEvents = ['mousedown', 'mousemove', 'mouseup'];
    for (const eventType of mouseEvents) {
      window.addEventListener(
        eventType,
        (event) => {
          if (!(event instanceof MouseEvent)) {
            return;
          }
          updateAuxMouseState(event);
        },
        true
      );
    }

    window.addEventListener(
      'blur',
      () => {
        activeAuxMouseButtons = 0;
      },
      true
    );

    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.visibilityState !== 'visible') {
          activeAuxMouseButtons = 0;
        }
      },
      true
    );
  };

  ipcRenderer.on(WINTAB_STATUS_CHANNEL, (_event, status: WinTabStatusPayload) => {
    bridgeEnabled = status.enabled;
    if (bridgeEnabled) {
      installSuppression();
      installMouseButtonTracking();
    }
  });

  ipcRenderer.on(WINTAB_EVENT_CHANNEL, (_event, payload: WinTabPenEventPayload) => {
    if (!bridgeEnabled) {
      return;
    }

    if (activeAuxMouseButtons !== 0) {
      if (payload.kind === 'up') {
        activeTarget = null;
        syntheticPenSessionActive = false;
        syntheticMouseSessionActive = false;
      }
      return;
    }

    const target = getDispatchTarget(payload);
    if (!target) {
      return;
    }

    if (payload.kind === 'down') {
      let dispatchTarget = target;
      let shouldUseSyntheticMouse = isSyntheticMouseTarget(dispatchTarget);
      if (!shouldUseSyntheticMouse) {
        dismissTransientUi(payload);
        dispatchTarget = getCurrentHoverTarget(payload);
        shouldUseSyntheticMouse = isSyntheticMouseTarget(dispatchTarget);
      }

      activeTarget = dispatchTarget;
      syntheticPenSessionActive = true;
      syntheticMouseSessionActive = shouldUseSyntheticMouse;
      dispatchSyntheticPointer(dispatchTarget, 'pointerdown', payload);
      if (syntheticMouseSessionActive) {
        dispatchSyntheticMouse(dispatchTarget, 'mousedown', payload);
      }
      return;
    }

    if (payload.kind === 'move') {
      if (!syntheticPenSessionActive) {
        return;
      }
      dispatchSyntheticPointer(activeTarget ?? target, 'pointermove', payload);
      if (syntheticMouseSessionActive) {
        dispatchSyntheticMouse(getCurrentHoverTarget(payload), 'mousemove', payload);
      }
      return;
    }

    if (payload.kind === 'up') {
      endSyntheticPenSession(payload);
    }
  });
}
