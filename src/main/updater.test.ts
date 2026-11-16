import type { BrowserWindow, MessageBoxOptions } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  quitAndInstall: vi.fn(),
  showMessageBox: vi.fn(),
}));

vi.mock('electron', () => ({ dialog: { showMessageBox: mocks.showMessageBox } }));
vi.mock('electron-updater', () => ({
  default: {
    autoUpdater: {
      checkForUpdates: mocks.checkForUpdates,
      currentVersion: '1.0.0',
      downloadUpdate: mocks.downloadUpdate,
      quitAndInstall: mocks.quitAndInstall,
    },
  },
}));
vi.mock('./store', () => ({ store: { get: () => false } }));

import { checkForUpdates, isWindowsArm64Build, shouldAllowPrerelease } from '@/main/updater';

describe('isWindowsArm64Build', () => {
  it('is decided by the binary architecture, not the machine', () => {
    expect(isWindowsArm64Build('win32', 'arm64')).toBe(true);
    // An x64 launcher under emulation on an ARM64 machine is still the x64 build and follows the x64 channel.
    expect(isWindowsArm64Build('win32', 'x64')).toBe(false);
    expect(isWindowsArm64Build('darwin', 'arm64')).toBe(false);
    expect(isWindowsArm64Build('linux', 'x64')).toBe(false);
  });
});

describe('shouldAllowPrerelease', () => {
  it('honours the opt-in everywhere but the Windows ARM64 build', () => {
    expect(shouldAllowPrerelease(true, 'win32', 'x64')).toBe(true);
    expect(shouldAllowPrerelease(true, 'darwin', 'arm64')).toBe(true);
    expect(shouldAllowPrerelease(true, 'linux', 'x64')).toBe(true);
    expect(shouldAllowPrerelease(false, 'win32', 'x64')).toBe(false);
  });

  it('never follows prereleases on the Windows ARM64 build', () => {
    // electron-updater's prerelease path swaps the channel for the tag's prerelease name (rc.yml, which no build
    // writes) and falls back to latest.yml, the x64 manifest, handing this build the x64 installer.
    expect(shouldAllowPrerelease(true, 'win32', 'arm64')).toBe(false);
    expect(shouldAllowPrerelease(false, 'win32', 'arm64')).toBe(false);
  });
});

describe('checkForUpdates', () => {
  const mainWindow = {} as BrowserWindow;

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.checkForUpdates.mockResolvedValue({ isUpdateAvailable: true, updateInfo: { version: '2.0.0' } });
    mocks.downloadUpdate.mockResolvedValue([]);
    mocks.showMessageBox.mockResolvedValueOnce({ response: 0 });
  });

  it('keeps the launcher running when the user chooses Later', async () => {
    mocks.showMessageBox.mockResolvedValueOnce({ response: 1 });

    await checkForUpdates(mainWindow);

    expect(mocks.showMessageBox).toHaveBeenNthCalledWith(
      2,
      mainWindow,
      expect.objectContaining({ buttons: ['Restart and Install', 'Later'] })
    );
    expect(mocks.quitAndInstall).not.toHaveBeenCalled();
  });

  it('keeps the launcher running when the user dismisses the downloaded update prompt', async () => {
    // Electron uses cancelId for Esc, with a fallback of 0 when no cancel button is configured.
    mocks.showMessageBox.mockImplementationOnce((_window: BrowserWindow, options: MessageBoxOptions) =>
      Promise.resolve({ response: options.cancelId ?? 0 })
    );

    await checkForUpdates(mainWindow);

    expect(mocks.downloadUpdate).toHaveBeenCalledOnce();
    expect(mocks.showMessageBox).toHaveBeenCalledTimes(2);
    expect(mocks.quitAndInstall).not.toHaveBeenCalled();
  });

  it('restarts when the user confirms installation', async () => {
    mocks.showMessageBox.mockResolvedValueOnce({ response: 0 });

    await checkForUpdates(mainWindow);

    expect(mocks.quitAndInstall).toHaveBeenCalledOnce();
  });
});
