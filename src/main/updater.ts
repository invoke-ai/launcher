import { dialog } from 'electron';
import electronUpdater from 'electron-updater';

import { store } from './store';

const { autoUpdater } = electronUpdater;

autoUpdater.logger = console;
autoUpdater.autoDownload = false;
// autoUpdater.forceDevUpdateConfig = true;

export const checkForUpdates = async () => {
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

    // These dialogs are intentionally not parented to the launcher window. The launcher can be hidden to the tray (or
    // minimized) at any point during the unbounded update check/download, and a window-modal dialog attached to a hidden
    // window is unreachable - the user could never click "Restart and Install". Top-level dialogs are always visible.
    const { response } = await dialog.showMessageBox({
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
      await dialog.showMessageBox({
        type: 'error',
        title: 'Update Download Error',
        message: 'An error occurred while downloading the update. Please try again later.',
      });
      return;
    }

    await dialog.showMessageBox({
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
