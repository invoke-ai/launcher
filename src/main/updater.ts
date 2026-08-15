import type { BrowserWindow } from 'electron';
import { dialog } from 'electron';
import electronUpdater from 'electron-updater';

import { store } from './store';

const { autoUpdater } = electronUpdater;

autoUpdater.logger = console;
autoUpdater.autoDownload = false;
// autoUpdater.forceDevUpdateConfig = true;

export const checkForUpdates = async (mainWindow: BrowserWindow, ensureVisible?: () => void) => {
  try {
    autoUpdater.allowPrerelease = store.get('optInToLauncherPrereleases');
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
      // Make sure the launcher is visible - it may have been hidden to the tray while the download ran.
      ensureVisible?.();
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Update Download Error',
        message: 'An error occurred while downloading the update. Please try again later.',
      });
    }

    // The download can take a while, during which the launcher may have auto-hidden to the tray. Bring it back so this
    // blocking prompt is actually visible and reachable before we quit to install.
    ensureVisible?.();

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
