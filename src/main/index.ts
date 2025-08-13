import { app, dialog, shell } from 'electron';
import { join } from 'path';
import { assert } from 'tsafe';

import { createConsoleManager } from '@/main/console-manager';
import { createInstallManager } from '@/main/install-manager';
import { createInvokeManager } from '@/main/invoke-manager';
import { MainProcessManager } from '@/main/main-process-manager';
import { store } from '@/main/store';
import {
  getHomeDirectory,
  getInstallationDetails,
  getOperatingSystem,
  isDirectory,
  isFile,
  pathExists,
} from '@/main/util';

// Configure Chrome/Electron flags for better memory management

// Windows-specific, disables some fancy desktop window effects that can use a lot of memory
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

// Prevent memory spikes from throttling when the app is in the background and moves to foreground
app.commandLine.appendSwitch('disable-background-timer-throttling');

// Keep renderer active when minimized to avoid memory spikes when restoring
app.commandLine.appendSwitch('disable-renderer-backgrounding');

// Remove limits on number of backing stores, which are per-window/tab. Theoretically, the launcher should only have two
// windows open at a time so this should have no effect. But just in case, we disable the limit.
app.commandLine.appendSwitch('disable-backing-store-limit');

const main = new MainProcessManager({ store });
let isShuttingDown = false;

// Create ConsoleManager for terminal functionality
const [, cleanupConsole] = createConsoleManager({
  ipc: main.ipc,
  sendToWindow: main.sendToWindow,
});

const [install, cleanupInstall] = createInstallManager({
  ipc: main.ipc,
  sendToWindow: main.sendToWindow,
});
const [invoke, cleanupInvoke] = createInvokeManager({
  store,
  ipc: main.ipc,
  sendToWindow: main.sendToWindow,
});

main.ipc.handle('main-process:get-status', () => main.getStatus());
main.ipc.handle('install-process:get-status', () => install.getStatus());
main.ipc.handle('invoke-process:get-status', () => invoke.getStatus());

//#region App lifecycle

/**
 * Cleans up any running processes (installation or invoke).
 */
async function cleanup() {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  const results = await Promise.allSettled([cleanupInstall(), cleanupInvoke(), cleanupConsole()]);
  const errors = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason);

  if (errors.length > 0) {
    console.error('Error cleaning up processes:', errors);
  } else {
    console.debug('Successfully cleaned up all processes');
  }
  main.cleanup();
}

/**
 * This method will be called when Electron has finished initialization and is ready to create browser windows.
 * Some APIs can only be used after this event occurs.
 */
app.on('ready', main.createWindow);

/**
 * Quit when all windows are closed.
 */
app.on('window-all-closed', () => {
  if (!isShuttingDown) {
    app.quit();
  }
});

/**
 * When the launcher quits, cleanup any running processes.
 * TODO(psyche): cleanupProcesses uses SIGTERM to kill the processes. This allows processes to handle the signal and
 * perform cleanup, but we aren't waiting for the processes to exit before we quit the host application. Could this
 * result in orphaned or improperly cleaned up processes?
 */
app.on('before-quit', cleanup);

//#endregion

//#region Util API

main.ipc.handle('util:get-dir-details', (_, dir) => getInstallationDetails(dir));
main.ipc.handle('util:get-default-install-dir', () => join(getHomeDirectory(), 'invokeai'));
main.ipc.handle('util:select-directory', async (_, path) => {
  const mainWindow = main.getWindow();
  assert(mainWindow !== null, 'Main window is not initialized');

  const defaultPath = path && (await isDirectory(path)) ? path : app.getPath('home');

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    defaultPath,
  });

  return result.filePaths[0] ?? null;
});
main.ipc.handle('util:get-home-directory', () => getHomeDirectory());
main.ipc.handle('util:get-is-directory', (_, path) => isDirectory(path));
main.ipc.handle('util:get-is-file', (_, path) => isFile(path));
main.ipc.handle('util:get-path-exists', (_, path) => pathExists(path));
main.ipc.handle('util:get-os', () => getOperatingSystem());
main.ipc.handle('util:open-directory', (_, path) => shell.openPath(path));
main.ipc.handle('util:get-launcher-version', () => app.getVersion());
//#endregion
