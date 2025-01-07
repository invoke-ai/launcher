import type { IpcListener } from '@electron-toolkit/typed-ipc/main';
import { type ChildProcess, execFile } from 'child_process';
import { BrowserWindow, ipcMain, shell } from 'electron';
import type Store from 'electron-store';
import fs from 'fs/promises';
import ip from 'ip';
import { join } from 'path';
import { assert } from 'tsafe';

import { SimpleLogger } from '@/lib/simple-logger';
import { StringMatcher } from '@/lib/string-matcher';
import { FIRST_RUN_MARKER_FILENAME } from '@/main/constants';
import { getInstallationDetails, killProcess, manageWindowSize, pathExists } from '@/main/util';
import type {
  InvokeProcessStatus,
  IpcEvents,
  IpcRendererEvents,
  LogEntry,
  StoreData,
  WithTimestamp,
} from '@/shared/types';

export class InvokeManager {
  private process: ChildProcess | null;
  private status: WithTimestamp<InvokeProcessStatus>;
  private ipcLogger: (entry: WithTimestamp<LogEntry>) => void;
  private onStatusChange: (status: WithTimestamp<InvokeProcessStatus>) => void;
  private log: SimpleLogger;
  private window: BrowserWindow | null;
  private store: Store<StoreData>;

  constructor(arg: {
    store: Store<StoreData>;
    ipcLogger: InvokeManager['ipcLogger'];
    onStatusChange: InvokeManager['onStatusChange'];
  }) {
    this.window = null;
    this.store = arg.store;
    this.ipcLogger = arg.ipcLogger;
    this.onStatusChange = arg.onStatusChange;
    this.process = null;
    this.status = { type: 'uninitialized', timestamp: Date.now() };
    this.log = new SimpleLogger((entry) => {
      this.ipcLogger(entry);
      console[entry.level](entry.message);
    });
  }

  getStatus = (): WithTimestamp<InvokeProcessStatus> => {
    return this.status;
  };

  updateStatus = (status: InvokeProcessStatus): void => {
    this.status = { ...status, timestamp: Date.now() };
    this.onStatusChange(this.status);
  };

  startInvoke = async (location: string) => {
    this.updateStatus({ type: 'starting' });
    this.log.info('Starting up...\r\n');

    const dirDetails = await getInstallationDetails(location);
    const firstRunMarkerPath = join(location, FIRST_RUN_MARKER_FILENAME);
    const isFirstRun = await pathExists(firstRunMarkerPath);

    if (!dirDetails.isInstalled) {
      this.updateStatus({ type: 'error', error: { message: 'Invalid installation!' } });
      this.log.error('Invalid installation!\r\n');
      return;
    }

    if (isFirstRun) {
      // We'll remove the first run marker after the process has started
      this.log.info('Preparing first run of this install - may take a minute or two...\r\n');
    }

    const env: NodeJS.ProcessEnv = { ...process.env, INVOKEAI_ROOT: location };

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

    const invokeProcess = execFile(dirDetails.invokeExecPath, [], { env });
    this.process = invokeProcess;

    invokeProcess.on('spawn', () => {
      this.log.info(`Started Invoke process with PID: ${invokeProcess.pid}\r\n`);
    });

    invokeProcess.on('error', (error) => {
      if (invokeProcess.pid !== undefined) {
        // The process started but errored - handle this in the exit event
        return;
      }
      // Failed to start the process
      const { message } = error;
      this.updateStatus({ type: 'error', error: { message } });
      // Shouldn't be open but just in case
      this.closeWindow();
      this.log.error(`Process error: ${message}\r\n`);
    });

    assert(invokeProcess.stdout);
    invokeProcess.stdout.on('data', (data) => {
      this.log.info(data.toString());
    });

    assert(invokeProcess.stderr);
    invokeProcess.stderr.on('data', (data) => {
      this.log.info(data.toString());
    });

    invokeProcess.on('close', (code) => {
      if (code === 0 || code === null) {
        // The process exited normally or was killed via signal - treat as a normal exit
        // Windows does not have signals so we will not bother checking the signal
        this.updateStatus({ type: 'exited' });
      } else if (code !== 0) {
        // The process exited with a non-zero code
        this.updateStatus({ type: 'error', error: { message: `Process exited with code ${code}` } });
      }

      this.log.info(`Process exited with code: ${code ?? 0}\r\n`);

      this.closeWindow();

      this.process = null;
    });

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
        // Stop watching the process output
        invokeProcess.stderr?.off('data', urlWatcher.checkForMatch);
        invokeProcess.stdout?.off('data', urlWatcher.checkForMatch);

        const data: Extract<InvokeProcessStatus, { type: 'running' }>['data'] = {
          url,
          loopbackUrl: url.replace('0.0.0.0', '127.0.0.1'),
        };

        // If uvicorn prints the URL with 0.0.0.0 for the host, that means it's accessible on the LAN
        if (url.includes('0.0.0.0')) {
          data.lanUrl = url.replace('0.0.0.0', ip.address());
        }

        // Only open the window if server mode is not enabled
        if (!this.store.get('serverMode')) {
          this.createWindow(data.loopbackUrl);
        }

        this.updateStatus({ type: 'running', data });

        if (isFirstRun) {
          // This is the first run after an install or update - remove the first run marker
          fs.rm(firstRunMarkerPath).catch((error) => {
            this.log.error(`Error removing first run marker: ${error.message}\r\n`);
          });
        }
      },
    });

    // Start watching the process output
    invokeProcess.stdout.on('data', urlWatcher.checkForMatch);
    invokeProcess.stderr.on('data', urlWatcher.checkForMatch);
  };

  createWindow = (url: string): void => {
    const window = new BrowserWindow({
      minWidth: 800,
      minHeight: 600,
      webPreferences: {
        devTools: true,
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

  exitInvoke = () => {
    this.log.info('Shutting down...\r\n');
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
    if (!this.process) {
      return;
    }
    killProcess(this.process);
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
  });

  ipc.handle('invoke-process:start-invoke', (_, installLocation) => {
    invokeManager.startInvoke(installLocation);
  });
  ipc.handle('invoke-process:exit-invoke', () => {
    invokeManager.exitInvoke();
  });

  const cleanupInvokeManager = () => {
    const status = invokeManager.getStatus();
    if (status.type === 'running' || status.type === 'starting') {
      invokeManager.exitInvoke();
    }
    ipcMain.removeHandler('invoke-process:start-invoke');
    ipcMain.removeHandler('invoke-process:exit-invoke');
  };

  return [invokeManager, cleanupInvokeManager] as const;
};
