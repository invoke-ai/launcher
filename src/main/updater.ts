import type { BrowserWindow } from 'electron';
import { dialog } from 'electron';
import electronUpdater from 'electron-updater';

import { store } from './store';

const { autoUpdater } = electronUpdater;

autoUpdater.logger = console;
autoUpdater.autoDownload = false;
// autoUpdater.forceDevUpdateConfig = true;

export const checkForUpdates = async (mainWindow: BrowserWindow) => {
  try {
    autoUpdater.allowPrerelease = store.get('launcherPrerelease');
    const updateCheckResult = await autoUpdater.checkForUpdates();
    if (!updateCheckResult) {
      return;
    }
    if (!updateCheckResult.isUpdateAvailable) {
      return;
    }
    const { updateInfo } = updateCheckResult;
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: 'Update Available',
      message: `A Launcher update is available: ${updateInfo.version}. Download and install?`,
      buttons: ['Yes', 'No'],
    });

    if (response !== 0) {
      return;
    }

    try {
      await autoUpdater.downloadUpdate();
    } catch {
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Update Download Error',
        message: 'An error occurred while downloading the update. Please try again later.',
      });
    }

    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update Ready to Install',
      message: 'The Launcher will restart and install the update.',
    });

    autoUpdater.quitAndInstall();
  } catch {
    // no-op
  }
};
