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
    autoUpdater.allowPrerelease = store.get('optInToLauncherPrereleases');
    const updateCheckResult = await autoUpdater.checkForUpdates();
    if (!updateCheckResult) {
      return;
    }
    if (!updateCheckResult.isUpdateAvailable) {
      return;
    }
    const { updateInfo } = updateCheckResult;
    const messageLines = [
      'A Launcher update is available.',
      '',
      `Current version: ${autoUpdater.currentVersion}`,
      `Available version: ${updateInfo.version}.`,
      '',
      'The update will be downloaded in the background. You will be notified when the download is complete and the update is ready to install.',
    ];

    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: 'Update Available',
      message: messageLines.join('\n'),
      buttons: ['Download', 'Cancel'],
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
      title: 'Update Downloaded',
      message: 'Update downloaded and ready to install.',
      buttons: ['Restart and Install'],
    });

    autoUpdater.quitAndInstall();
  } catch {
    // no-op
  }
};
