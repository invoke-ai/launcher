import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { updater, dialog } = vi.hoisted(() => ({
  updater: {
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    currentVersion: '1.0.0',
    autoInstallOnAppQuit: true,
  },
  dialog: { showMessageBox: vi.fn() },
}));
vi.mock('electron', () => ({ dialog }));
vi.mock('electron-updater', () => ({ default: { autoUpdater: updater } }));
vi.mock('./store', () => ({ store: { get: () => false } }));

import { checkForUpdates } from './updater';

describe('installing a downloaded update', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  const window = { isDestroyed: () => false } as BrowserWindow;
  let dir: string;
  let installer: string;

  beforeEach(async () => {
    vi.resetAllMocks();
    dir = await mkdtemp(join(tmpdir(), 'launcher-update-'));
    installer = join(dir, 'installer.exe');
    await writeFile(installer, 'test fixture');
    Object.defineProperty(process, 'platform', { value: 'win32' });
    updater.autoInstallOnAppQuit = true;
    updater.checkForUpdates.mockResolvedValue({ isUpdateAvailable: true, updateInfo: { version: '2' } });
    updater.downloadUpdate.mockResolvedValue([installer]);
    dialog.showMessageBox.mockResolvedValue({ response: 0 });
  });

  afterEach(async () => {
    Object.defineProperty(process, 'platform', platform);
    await rm(dir, { recursive: true, force: true });
  });

  it('continues with the staged installer after confirmation', async () => {
    await checkForUpdates(window);
    expect(updater.quitAndInstall).toHaveBeenCalledOnce();
    expect(updater.autoInstallOnAppQuit).toBe(true);
  });

  it('keeps running when the installer disappears while waiting for confirmation', async () => {
    dialog.showMessageBox.mockResolvedValueOnce({ response: 0 }).mockImplementationOnce(async () => {
      await rm(installer);
      return { response: 0 };
    });
    await checkForUpdates(window);
    expect(dialog.showMessageBox).toHaveBeenLastCalledWith(window, expect.objectContaining({ type: 'error' }));
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    expect(updater.autoInstallOnAppQuit).toBe(false);
  });

  it.each(['directory', 'empty file', 'no paths'])('rejects an unusable download (%s)', async (kind) => {
    if (kind === 'directory') {
      updater.downloadUpdate.mockResolvedValue([dir]);
    } else if (kind === 'no paths') {
      updater.downloadUpdate.mockResolvedValue([]);
    } else {
      await writeFile(installer, '');
    }
    await checkForUpdates(window);
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    expect(dialog.showMessageBox).toHaveBeenLastCalledWith(window, expect.objectContaining({ type: 'error' }));
  });

  it('shows the installation error without a parent if the launcher window was closed', async () => {
    updater.downloadUpdate.mockResolvedValue([]);
    await checkForUpdates({ isDestroyed: () => true } as BrowserWindow);
    expect(dialog.showMessageBox).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'error' }));
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('leaves the platform-specific staging to the macOS updater', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    updater.downloadUpdate.mockResolvedValue([]);
    await checkForUpdates(window);
    expect(updater.quitAndInstall).toHaveBeenCalledOnce();
  });
});
