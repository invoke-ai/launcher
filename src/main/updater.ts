import type { BrowserWindow } from 'electron';
import { dialog } from 'electron';
import electronUpdater from 'electron-updater';

import { store } from './store';

const { autoUpdater } = electronUpdater;

autoUpdater.logger = console;
autoUpdater.autoDownload = false;
// autoUpdater.forceDevUpdateConfig = true;

/**
 * Whether this launcher binary is the Windows ARM64 build. `process.arch` is the binary's architecture, which is the
 * right question here: the update channel is baked into the build (see electron-builder.config.ts), so an x64 launcher
 * running under emulation on an ARM64 machine still follows the x64 channel.
 */
export const isWindowsArm64Build = (platform = process.platform, arch = process.arch): boolean =>
  platform === 'win32' && arch === 'arm64';

/**
 * Whether the updater may follow prereleases for this build.
 *
 * The Windows ARM64 build reads its own manifest, `latest-arm64.yml`. With prereleases allowed, electron-updater
 * replaces the channel with the tag's prerelease name (`rc.yml`, which no build writes) and then falls back to
 * `latest.yml` -- the x64 manifest, whose first installer is the x64 one. Either way an ARM64 launcher would be
 * handed the x64 installer, so the opt-in is honoured everywhere except on that build.
 */
export const shouldAllowPrerelease = (optIn: boolean, platform = process.platform, arch = process.arch): boolean =>
  optIn && !isWindowsArm64Build(platform, arch);

export const checkForUpdates = async (mainWindow: BrowserWindow) => {
  try {
    autoUpdater.allowPrerelease = shouldAllowPrerelease(store.get('optInToLauncherPrereleases'));
    const updateCheckResult = await autoUpdater.checkForUpdates();
    if (!updateCheckResult) {
      return;
    }
    if (!updateCheckResult.isUpdateAvailable) {
      return;
    }
    const { updateInfo } = updateCheckResult;
    const message = [
      'A Launcher update is available.',
      '',
      `Installed version: ${autoUpdater.currentVersion}`,
      `Available version: ${updateInfo.version}`,
      '',
      'The update will be downloaded in the background. You will be notified when the download is complete and the update is ready to install.',
    ].join('\n');

    // These dialogs are parented to the launcher window so they are modal to it while it is visible. If the launcher has
    // been hidden to the tray by auto-hide, Electron degrades a dialog with a non-shown parent to an independent
    // top-level window, so it stays reachable either way.
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: 'Update Available',
      message,
      buttons: ['Download', 'Cancel'],
    });

    if (response !== 0) {
      return;
    }

    try {
      await autoUpdater.downloadUpdate();
    } catch {
      await dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Update Download Error',
        message: 'An error occurred while downloading the update. Please try again later.',
      });
      return;
    }

    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Downloaded',
      message: 'Update downloaded and ready to install.',
      buttons: ['Restart and Install'],
    });

    autoUpdater.quitAndInstall();
  } catch {
    // no-op
  }
};
