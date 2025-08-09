import type { IpcListener } from '@electron-toolkit/typed-ipc/main';
import c from 'ansi-colors';
import { BrowserWindow, ipcMain, shell } from 'electron';
import type Store from 'electron-store';
import fs from 'fs/promises';
import ip from 'ip';
import { join } from 'path';

import { CommandRunner } from '@/lib/command-runner';
import { DEFAULT_ENV } from '@/lib/pty-utils';
import { SimpleLogger } from '@/lib/simple-logger';
import { StringMatcher } from '@/lib/string-matcher';
import { FIRST_RUN_MARKER_FILENAME } from '@/main/constants';
import { getInstallationDetails, manageWindowSize, pathExists } from '@/main/util';
import type {
  InvokeProcessStatus,
  IpcEvents,
  IpcRendererEvents,
  LogEntry,
  StoreData,
  WithTimestamp,
} from '@/shared/types';

import type { InstallManager } from './install-manager';

export class InvokeManager {
  private status: WithTimestamp<InvokeProcessStatus>;
  private ipcLogger: (entry: WithTimestamp<LogEntry>) => void;
  private ipcRawOutput: (data: string) => void;
  private onStatusChange: (status: WithTimestamp<InvokeProcessStatus>) => void;
  private sendClearLogs?: () => void;
  private log: SimpleLogger;
  private window: BrowserWindow | null;
  private store: Store<StoreData>;
  private lastRunningData: { url: string; loopbackUrl: string; lanUrl?: string } | null;
  private commandRunner: CommandRunner;
  private cols: number | undefined;
  private rows: number | undefined;

  constructor(arg: {
    store: Store<StoreData>;
    ipcLogger: InvokeManager['ipcLogger'];
    onStatusChange: InvokeManager['onStatusChange'];
    sendClearLogs?: InvokeManager['sendClearLogs'];
    ipcRawOutput: InstallManager['ipcRawOutput'];
  }) {
    this.window = null;
    this.store = arg.store;
    this.ipcLogger = arg.ipcLogger;
    this.onStatusChange = arg.onStatusChange;
    this.sendClearLogs = arg.sendClearLogs;
    this.status = { type: 'uninitialized', timestamp: Date.now() };
    this.lastRunningData = null;
    this.ipcRawOutput = arg.ipcRawOutput;
    this.log = new SimpleLogger((entry) => {
      this.ipcRawOutput(entry.message);
      console[entry.level](entry.message);
    });
    this.commandRunner = new CommandRunner();
    this.cols = undefined;
    this.rows = undefined;
  }

  getStatus = (): WithTimestamp<InvokeProcessStatus> => {
    return this.status;
  };

  updateStatus = (status: InvokeProcessStatus): void => {
    this.status = { ...status, timestamp: Date.now() };
    this.onStatusChange(this.status);
  };

  /**
   * Resize the current PTY if one is active
   */
  resizePty = (cols: number, rows: number): void => {
    this.cols = cols;
    this.rows = rows;
    this.commandRunner.resize(cols, rows);
  };

  startInvoke = async (location: string) => {
    this.updateStatus({ type: 'starting' });

    // Clear logs from previous session
    this.sendClearLogs?.();

    const dirDetails = await getInstallationDetails(location);
    const firstRunMarkerPath = join(location, FIRST_RUN_MARKER_FILENAME);
    const isFirstRun = await pathExists(firstRunMarkerPath);

    if (!dirDetails.isInstalled) {
      this.updateStatus({ type: 'error', error: { message: 'Invalid installation!' } });
      this.log.error(c.red('Invalid installation!\r\n'));
      return;
    }

    if (isFirstRun) {
      // We'll remove the first run marker after the process has started
      this.log.info(c.magenta.bold('Preparing first run of this install - may take a minute or two...\r\n'));
    }

    const env: Record<string, string> = { ...process.env, INVOKEAI_ROOT: location, ...DEFAULT_ENV };

    // If server mode is enabled, set the host to 0.0.0.0 to enable LAN access
    if (this.store.get('serverMode')) {
      env.INVOKEAI_HOST = '0.0.0.0';
    }

    if (this.store.get('enablePartialLoading')) {
      env.INVOKEAI_ENABLE_PARTIAL_LOADING = '1';
    }

    // Some torch operations are not yet supported on MPS. This tells torch to use CPU for those operations.
    // See: https://pytorch.org/docs/stable/mps_environment_variables.html
    if (process.platform === 'darwin') {
      env.PYTORCH_ENABLE_MPS_FALLBACK = '1';
    }

    // Clean up any previous command if it exists
    if (this.commandRunner.isRunning()) {
      this.commandRunner.kill();
    }

    /**
     * Watch the process output for the indication that the server is running, then:
     * - Open the window
     * - Update the invoke status
     * - Remove the first run marker if it's the first run since an install or update
     */
    const urlWatcher = new StringMatcher({
      // Match HTTP and HTTPS URLs
      re: /https?:\/\/[^:\s]+:\d+/,
      // We only care about messages that indicate the server is running
      filter: (data) => data.includes('Uvicorn running') || data.includes('Invoke running'),
      onMatch: (url) => {
        // URL watcher is called directly from onData callback, no need to unsubscribe

        const data: Extract<InvokeProcessStatus, { type: 'running' }>['data'] = {
          url,
          loopbackUrl: url.replace('0.0.0.0', '127.0.0.1'),
        };

        // If uvicorn prints the URL with 0.0.0.0 for the host, that means it's accessible on the LAN
        if (url.includes('0.0.0.0')) {
          data.lanUrl = url.replace('0.0.0.0', ip.address());
        }

        // Store the running data for potential window reopening
        this.lastRunningData = data;

        // Only open the window if server mode is not enabled
        if (!this.store.get('serverMode')) {
          this.createWindow(data.loopbackUrl);
        }

        this.updateStatus({ type: 'running', data });

        if (isFirstRun) {
          // This is the first run after an install or update - remove the first run marker
          fs.rm(firstRunMarkerPath).catch((error) => {
            this.log.error(c.red(`Error removing first run marker: ${error.message}\r\n`));
          });
        }
      },
    });

    // Start the invoke process - we don't await this since it's a long-running process
    this.commandRunner
      .runCommand(
        dirDetails.invokeExecPath,
        [],
        {
          cwd: location,
          env,
          rows: this.rows,
          cols: this.cols,
        },
        {
          onData: (data) => {
            // Send raw PTY output for proper terminal handling
            this.ipcRawOutput(data);
            process.stdout.write(data);

            // Also check for URL in the output
            urlWatcher.checkForMatch(data);
          },
          onExit: (exitCode, signal) => {
            if (exitCode === 0) {
              // Process exited on its own with no error
              this.updateStatus({ type: 'exited' });
              this.log.info(c.green.bold('Invoke process exited normally\r\n'));
            } else if (signal !== undefined && signal !== null) {
              // Process was killed via signal
              this.updateStatus({ type: 'exited' });
              this.log.info(c.yellow(`Invoke process was terminated with signal ${signal}, exit code ${exitCode}\r\n`));
            } else if (exitCode !== null) {
              // Process exited on its own, with a non-zero code, indicating an error
              this.updateStatus({ type: 'error', error: { message: `Process exited with code ${exitCode}` } });
              this.log.info(c.red(`Invoke process exited with code ${exitCode}\r\n`));
            } else {
              // Process was killed without a specific exit code or signal - think this is impossible?
              this.updateStatus({ type: 'error', error: { message: 'Process was killed unexpectedly' } });
              this.log.info(c.red('Invoke process was killed unexpectedly\r\n'));
            }

            this.closeWindow();
          },
        }
      )
      .catch((error) => {
        this.updateStatus({ type: 'error', error: { message: error.message } });
        this.log.error(c.red(`Failed to start Invoke process: ${error.message}\r\n`));
      });

    const pid = this.commandRunner.getPid();
    if (pid) {
      this.log.info(c.cyan(`Started Invoke process with PID ${pid}\r\n`));
    }
  };

  createWindow = (url: string): void => {
    const window = new BrowserWindow({
      minWidth: 800,
      minHeight: 600,
      webPreferences: {
        devTools: true,
        backgroundThrottling: false, // Prevent memory spikes from throttling when window loses focus
        additionalArguments: [
          '--enable-gpu-rasterization', // Offload canvas to GPU
          '--enable-zero-copy', // Reduce memory copies
          '--enable-accelerated-2d-canvas', // GPU acceleration for 2D canvas
        ],
      },
      autoHideMenuBar: true,
      frame: true,
      backgroundColor: 'hsl(220, 12%, 10%)',
      show: false,
    });

    this.window = window;

    const winProps = this.store.get('appWindowProps');
    manageWindowSize(
      window,
      winProps,
      (windowProps) => {
        this.store.set('appWindowProps', windowProps);
      },
      { isMaximized: true }
    );

    window.on('ready-to-show', () => {
      window.webContents.insertCSS(`* { outline: none; }`);
      window.show();
    });
    window.on('close', this.exitInvoke);

    // Add crash/OOM detection
    let unresponsiveTimestamp: number | null = null;

    window.webContents.on('render-process-gone', (event, details) => {
      const reasonMessage =
        details.reason === 'oom'
          ? 'Out of Memory (OOM)'
          : details.reason === 'crashed'
            ? 'Crashed'
            : details.reason === 'killed'
              ? 'Killed'
              : `Unknown (${details.reason})`;

      this.log.error(c.red(`UI Window unexpectedly exited with exit code ${details.exitCode}: ${reasonMessage}\r\n`));

      // Update status to window-crashed if we still have the running data
      if (this.lastRunningData && this.commandRunner.isRunning()) {
        this.updateStatus({
          type: 'window-crashed',
          data: {
            ...this.lastRunningData,
            crashReason: reasonMessage,
          },
        });
        this.log.info(c.cyan(`UI Window can be reopened - server is still running\r\n`));
      }

      // Close the crashed window (it may still be visible but unresponsive)
      if (this.window && !this.window.isDestroyed()) {
        this.window.destroy();
      }

      // Clean up the window reference
      this.window = null;
    });

    window.webContents.on('unresponsive', () => {
      unresponsiveTimestamp = Date.now();
      this.log.warn(c.yellow(`UI Window is unresponsive\r\n`));
    });

    window.webContents.on('responsive', () => {
      if (unresponsiveTimestamp) {
        const duration = Date.now() - unresponsiveTimestamp;
        this.log.info(c.yellow(`UI Window is responsive again (was unresponsive for ${duration}ms)\r\n`));
        unresponsiveTimestamp = null;
      }
    });

    window.webContents.setWindowOpenHandler((handlerDetails) => {
      // If the URL is the same as the main URL, allow it to open in an electron window. This is for things like
      // opening images in a new tab
      if (handlerDetails.url.includes(url)) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            // Prevent a flash when opening an image in a new tab - not sure how to make the background color match the
            // app after the flash, it changes to black after the image loads
            backgroundColor: 'black',
          },
        };
      }

      // Else, open the URL in the default browser. This includes things like support video links, github, etc.
      shell.openExternal(handlerDetails.url);
      return { action: 'deny' };
    });

    const localUrl = url.replace('0.0.0.0', '127.0.0.1');
    window.webContents.loadURL(localUrl);
  };

  reopenWindow = (): void => {
    // Check if we can reopen the window
    if (this.window && !this.window.isDestroyed()) {
      this.log.warn('Window is already open\r\n');
      return;
    }

    if (!this.lastRunningData) {
      this.log.error(c.red('Cannot reopen window - no running data available\r\n'));
      return;
    }

    if (!this.commandRunner.isRunning()) {
      this.log.error(c.red('Cannot reopen window - process is not running\r\n'));
      return;
    }

    this.log.info('Reopening Invoke UI window...\r\n');
    this.createWindow(this.lastRunningData.loopbackUrl);

    // Update status back to running
    this.updateStatus({ type: 'running', data: this.lastRunningData });
  };

  exitInvoke = () => {
    this.log.info(c.cyan('Shutting down...\r\n'));
    this.updateStatus({ type: 'exiting' });
    this.closeWindow();
    this.killProcess();
  };

  closeWindow = (): void => {
    if (!this.window) {
      return;
    }
    if (!this.window.isDestroyed()) {
      this.window.destroy();
    }
    this.window = null;
  };

  killProcess = (): void => {
    if (!this.commandRunner.isRunning()) {
      return;
    }
    this.commandRunner.kill();
  };
}

/**
 * Helper function to create an `InvokeManager` instance and set up IPC handlers for it. Returns the instance
 * and a cleanup function that should be called when the application is shutting down.
 */
export const createInvokeManager = (arg: {
  store: Store<StoreData>;
  ipc: IpcListener<IpcEvents>;
  sendToWindow: <T extends keyof IpcRendererEvents>(channel: T, ...args: IpcRendererEvents[T]) => void;
}) => {
  const { store, ipc, sendToWindow } = arg;
  const invokeManager = new InvokeManager({
    store,
    ipcLogger: (entry) => {
      sendToWindow('invoke-process:log', entry);
    },
    onStatusChange: (status) => {
      sendToWindow('invoke-process:status', status);
    },
    sendClearLogs: () => {
      sendToWindow('invoke-process:clear-logs');
    },
    ipcRawOutput: (data) => {
      sendToWindow('invoke-process:raw-output', data);
    },
  });

  ipc.handle('invoke-process:start-invoke', (_, installLocation) => {
    invokeManager.startInvoke(installLocation);
  });
  ipc.handle('invoke-process:exit-invoke', () => {
    invokeManager.exitInvoke();
  });
  ipc.handle('invoke-process:reopen-window', () => {
    invokeManager.reopenWindow();
  });
  ipc.handle('invoke-process:resize', (_, cols, rows) => {
    invokeManager.resizePty(cols, rows);
  });

  const cleanupInvokeManager = () => {
    const status = invokeManager.getStatus();
    if (status.type === 'running' || status.type === 'starting') {
      invokeManager.exitInvoke();
    }
    ipcMain.removeHandler('invoke-process:start-invoke');
    ipcMain.removeHandler('invoke-process:exit-invoke');
    ipcMain.removeHandler('invoke-process:resize');
  };

  return [invokeManager, cleanupInvokeManager] as const;
};
