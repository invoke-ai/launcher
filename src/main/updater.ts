import { open } from 'node:fs/promises';

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

async function checkStagedInstaller(installerPath: string | undefined) {
  if (!installerPath) {
    throw new Error('The updater returned no installer');
  }
  const installer = await open(installerPath, 'r');
  try {
    const stat = await installer.stat();
    if (!stat.isFile() || stat.size === 0) {
      throw new Error('The staged installer is not a non-empty file');
    }
  } finally {
    await installer.close();
  }
}

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

    let downloadedFiles: string[];
    try {
      downloadedFiles = await autoUpdater.downloadUpdate();
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

    // NSIS queues app.quit() before it knows whether the installer launched. Check the
    // staged executable after the dialog, since it may have been quarantined while we waited.
    if (process.platform === 'win32') {
      try {
        await checkStagedInstaller(downloadedFiles[0]);
      } catch (error) {
        console.warn('Cannot open the downloaded update installer:', error);
        // The updater also installs on ordinary quit. Skip that same unusable file this session.
        autoUpdater.autoInstallOnAppQuit = false;
        const options = {
          type: 'error' as const,
          title: 'Update Installation Error',
          message:
            'The downloaded installer is missing or unreadable. Restart the Launcher to check for the update again.',
        };
        if (mainWindow.isDestroyed()) {
          await dialog.showMessageBox(options);
        } else {
          await dialog.showMessageBox(mainWindow, options);
        }
        return;
      }
    }
    autoUpdater.quitAndInstall();
  } catch {
    // no-op
  }
};
