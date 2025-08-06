import type { IpcListener } from '@electron-toolkit/typed-ipc/main';
import { type ChildProcess, exec, execFile } from 'child_process';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import type Store from 'electron-store';
import fs from 'fs/promises';
import ip from 'ip';
import os from 'os';
import { join } from 'path';
import { assert } from 'tsafe';
import { promisify } from 'util';

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
  private onMetricsUpdate: (metrics: { memoryBytes: number; cpuPercent: number }) => void;
  private log: SimpleLogger;
  private window: BrowserWindow | null;
  private store: Store<StoreData>;
  private metricsInterval: NodeJS.Timeout | null;
  private lastMetrics: { memoryBytes: number; cpuPercent: number } | null;

  constructor(arg: {
    store: Store<StoreData>;
    ipcLogger: InvokeManager['ipcLogger'];
    onStatusChange: InvokeManager['onStatusChange'];
    onMetricsUpdate: InvokeManager['onMetricsUpdate'];
  }) {
    this.window = null;
    this.store = arg.store;
    this.ipcLogger = arg.ipcLogger;
    this.onStatusChange = arg.onStatusChange;
    this.onMetricsUpdate = arg.onMetricsUpdate;
    this.process = null;
    this.status = { type: 'uninitialized', timestamp: Date.now() };
    this.metricsInterval = null;
    this.lastMetrics = null;
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

  startMetricsMonitoring = (): void => {
    if (this.metricsInterval) {
      return;
    }

    const execAsync = promisify(exec);
    const platform = os.platform();

    const getProcessMemory = async (pid: number): Promise<number> => {
      try {
        if (platform === 'darwin') {
          // macOS: Use ps to get RSS (resident set size) in KB
          const { stdout } = await execAsync(`ps -o rss= -p ${pid}`);
          const kb = parseInt(stdout.trim(), 10);
          return kb * 1024; // Convert KB to bytes
        } else if (platform === 'linux') {
          // Linux: Read from /proc/[pid]/status
          const status = await fs.readFile(`/proc/${pid}/status`, 'utf-8');
          const match = status.match(/VmRSS:\s+(\d+)\s+kB/);
          if (match) {
            return parseInt(match[1]!, 10) * 1024; // Convert KB to bytes
          }
        } else if (platform === 'win32') {
          // Windows: Use wmic to get WorkingSetSize in bytes
          const { stdout } = await execAsync(`wmic process where ProcessId=${pid} get WorkingSetSize /format:value`);
          const match = stdout.match(/WorkingSetSize=(\d+)/);
          if (match) {
            return parseInt(match[1]!, 10); // Already in bytes
          }
        }
      } catch {
        // Silently fall back to 0 if we can't get memory
      }
      return 0;
    };

    const sampleMetrics = async () => {
      try {
        if (!this.window || this.window.isDestroyed()) {
          return;
        }

        // Get the renderer process PID
        const rendererPid = this.window.webContents.getOSProcessId();

        // Get native memory usage from OS in bytes
        const memoryBytes = await getProcessMemory(rendererPid);

        // Get CPU from Electron metrics
        const metrics = app.getAppMetrics();
        const rendererMetric = metrics.find((m) => m.pid === rendererPid);
        const cpuPercent = rendererMetric ? Math.round(rendererMetric.cpu.percentCPUUsage) : 0;

        this.lastMetrics = { memoryBytes, cpuPercent };
        this.onMetricsUpdate(this.lastMetrics);
      } catch (error) {
        console.error('Error sampling metrics:', error);
      }
    };

    // Initial sample
    sampleMetrics();

    // Set up 1-second interval
    this.metricsInterval = setInterval(sampleMetrics, 1000);
  };

  stopMetricsMonitoring = (): void => {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }
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

    invokeProcess.on('close', (code, signal) => {
      if (code === 0) {
        // Process exited on its own with no error
        this.updateStatus({ type: 'exited' });
        this.log.info('Process exited normally\r\n');
      } else if (code !== null) {
        // Process exited on its own, with a non-zero code, indicating an error
        this.updateStatus({ type: 'error', error: { message: `Process exited with code ${code}` } });
        this.log.info(`Process exited with code ${code}\r\n`);
      } else if (signal !== null) {
        // Process exited due to a signal (e.g. user pressed clicked Shutdown)
        this.updateStatus({ type: 'exited' });
        this.log.info(`Process exited with signal ${signal}\r\n`);
      }

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
      // Start metrics monitoring when window is ready
      this.startMetricsMonitoring();
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

      this.log.error(`[CRASH] Invoke UI window process unexpectedly gone: ${reasonMessage}\r\n`);
      this.log.error(`[CRASH] Exit code: ${details.exitCode}\r\n`);

      // Log last known metrics
      if (this.lastMetrics) {
        const memoryMB = Math.round(this.lastMetrics.memoryBytes / 1024 / 1024);
        this.log.error(
          `[CRASH] Last known metrics - Memory: ${memoryMB} MB (${this.lastMetrics.memoryBytes} bytes), CPU: ${this.lastMetrics.cpuPercent}%\r\n`
        );
      }

      if (details.reason === 'oom') {
        this.log.error(`[OOM] The Invoke UI window crashed due to insufficient memory.\r\n`);
      }
    });

    window.webContents.on('unresponsive', () => {
      unresponsiveTimestamp = Date.now();
      this.log.warn(`[UNRESPONSIVE] Invoke UI has become unresponsive\r\n`);
    });

    window.webContents.on('responsive', () => {
      if (unresponsiveTimestamp) {
        const duration = Date.now() - unresponsiveTimestamp;
        this.log.info(`[RESPONSIVE] Invoke UI is responsive again (was unresponsive for ${duration}ms)\r\n`);
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

  exitInvoke = async () => {
    this.log.info('Shutting down...\r\n');
    this.updateStatus({ type: 'exiting' });
    this.closeWindow();
    await this.killProcess();
  };

  closeWindow = (): void => {
    this.stopMetricsMonitoring();
    if (!this.window) {
      return;
    }
    if (!this.window.isDestroyed()) {
      this.window.destroy();
    }
    this.window = null;
  };

  killProcess = async (): Promise<void> => {
    if (!this.process) {
      return;
    }
    await killProcess(this.process);
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
    onMetricsUpdate: (metrics) => {
      sendToWindow('invoke-process:metrics', metrics);
    },
  });

  ipc.handle('invoke-process:start-invoke', (_, installLocation) => {
    invokeManager.startInvoke(installLocation);
  });
  ipc.handle('invoke-process:exit-invoke', () => {
    invokeManager.exitInvoke();
  });

  const cleanupInvokeManager = async () => {
    const status = invokeManager.getStatus();
    if (status.type === 'running' || status.type === 'starting') {
      await invokeManager.exitInvoke();
    }
    ipcMain.removeHandler('invoke-process:start-invoke');
    ipcMain.removeHandler('invoke-process:exit-invoke');
  };

  return [invokeManager, cleanupInvokeManager] as const;
};
