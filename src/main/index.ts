import { app, BrowserWindow, dialog, shell } from 'electron';
import { join } from 'path';
import { assert } from 'tsafe';

import { createInstallManager } from '@/main/install-manager';
import { createInvokeManager } from '@/main/invoke-manager';
import { MainProcessManager } from '@/main/main-process-manager';
import { createPtyManager } from '@/main/pty-manager';
import { store } from '@/main/store';
import {
  getHomeDirectory,
  getInstallationDetails,
  getOperatingSystem,
  isDirectory,
  isFile,
  pathExists,
} from '@/main/util';
import { SimpleLogger } from '@/lib/simple-logger';
import { MemoryTracker } from '@/lib/memory-tracker';
import { SignalMonitor } from '@/lib/signal-monitor';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

const main = new MainProcessManager({ store });

// Initialize memory tracking and signal monitoring
const logger = new SimpleLogger((entry) => {
  console.log(`[${entry.level.toUpperCase()}] ${new Date(entry.timestamp).toISOString()} ${entry.message}`);
  // Also send to renderer for display in console
  main.sendToWindow('log:entry', entry);
});

const memoryTracker = new MemoryTracker({
  logger,
  intervalMs: 15000, // 15 seconds for more frequent monitoring during debugging
  maxSnapshots: 400, // Keep last 400 snapshots (~1.7 hours at 15s intervals)
});

const signalMonitor = new SignalMonitor({
  logger,
  memoryTracker,
});

// Start monitoring
logger.info('Initializing memory tracking and signal monitoring');
memoryTracker.start();
signalMonitor.start();

const [install, cleanupInstall] = createInstallManager({
  ipc: main.ipc,
  sendToWindow: main.sendToWindow,
});
const [invoke, cleanupInvoke] = createInvokeManager({
  store,
  ipc: main.ipc,
  sendToWindow: main.sendToWindow,
});
const [_pty, cleanupPty] = createPtyManager({
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
function cleanup() {
  logger.info('Starting application cleanup');
  
  // Stop monitoring first
  signalMonitor.stop();
  memoryTracker.stop();
  
  cleanupInstall();
  cleanupInvoke();
  cleanupPty();
  main.cleanup();
  
  logger.info('Application cleanup completed');
}

/**
 * This method will be called when Electron has finished initialization and is ready to create browser windows.
 * Some APIs can only be used after this event occurs.
 */
app.on('ready', main.createWindow);

/**
 * Quit when all windows are closed, except on macOS. There, it's common for applications and their menu bar to stay
 * active until the user quits explicitly with Cmd + Q.
 */
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
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

/**
 * On macOS, it's common to re-create a window in the app when the dock icon is clicked and there are no other windows
 * open.
 */
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    main.createWindow();
  }
});

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

// Memory tracking and signal monitoring API
main.ipc.handle('memory:get-snapshots', () => memoryTracker.getSnapshots());
main.ipc.handle('memory:get-latest-snapshot', () => memoryTracker.getLatestSnapshot());
main.ipc.handle('memory:generate-report', () => memoryTracker.generateReport());
main.ipc.handle('memory:detect-leaks', () => memoryTracker.detectMemoryLeaks());
main.ipc.handle('memory:force-gc', () => memoryTracker.forceGarbageCollection());
main.ipc.handle('memory:take-snapshot', () => memoryTracker.takeSnapshot());

main.ipc.handle('signal:get-events', () => signalMonitor.getSignalEvents());
main.ipc.handle('signal:get-latest-event', () => signalMonitor.getLatestSignalEvent());
main.ipc.handle('signal:trigger-dump', () => signalMonitor.triggerMemoryDump());

//#endregion
