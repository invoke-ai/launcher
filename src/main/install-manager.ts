import type { IpcListener } from '@electron-toolkit/typed-ipc/main';
import type { ExecFileOptions } from 'child_process';
import { execFile } from 'child_process';
import { ipcMain } from 'electron';
import type { ObjectEncodingOptions } from 'fs';
import fs from 'fs/promises';
import path, { join } from 'path';
import { serializeError } from 'serialize-error';
import { assert } from 'tsafe';

import { withResult, withResultAsync } from '@/lib/result';
import { SimpleLogger } from '@/lib/simple-logger';
import { FIRST_RUN_MARKER_FILENAME } from '@/main/constants';
import { getTorchPlatform, getUVExecutablePath, isDirectory, isFile } from '@/main/util';
import { getPins } from '@/shared/pins';
import type {
  GpuType,
  InstallProcessStatus,
  IpcEvents,
  IpcRendererEvents,
  LogEntry,
  WithTimestamp,
} from '@/shared/types';

export class InstallManager {
  private status: WithTimestamp<InstallProcessStatus>;
  private ipcLogger: (entry: WithTimestamp<LogEntry>) => void;
  private onStatusChange: (status: WithTimestamp<InstallProcessStatus>) => void;
  private log: SimpleLogger;
  private abortController: AbortController | null;

  constructor(arg: { ipcLogger: InstallManager['ipcLogger']; onStatusChange: InstallManager['onStatusChange'] }) {
    this.ipcLogger = arg.ipcLogger;
    this.onStatusChange = arg.onStatusChange;
    this.status = { type: 'uninitialized', timestamp: Date.now() };
    this.log = new SimpleLogger((entry) => {
      this.ipcLogger(entry);
      console[entry.level](entry.message);
    });
    this.abortController = null;
  }

  logRepairModeMessages = (): void => {
    this.log.info('Try installing again with Repair mode enabled to fix this.\r\n');
    this.log.info('Ask for help on Discord or GitHub if you continue to have issues.\r\n');
  };

  getStatus = (): WithTimestamp<InstallProcessStatus> => {
    return this.status;
  };

  updateStatus = (status: InstallProcessStatus): void => {
    this.status = { ...status, timestamp: Date.now() };
    this.onStatusChange(this.status);
  };

  startInstall = async (location: string, gpuType: GpuType, version: string, repair?: boolean) => {
    /**
     * Installation is a 2-step process:
     * - Create a virtual environment.
     * - Install the invokeai package.
     *
     * If repair mode is enabled, we do these additional steps before the above:
     * - Forcibly reinstall the uv-managed python.
     * - Delete any existing virtual environment.
     */

    this.updateStatus({ type: 'starting' });
    this.log.info('Starting up...\r\n');

    // Do some initial checks and setup

    // First make sure the install location is valid (e.g. it's a folder that exists)
    const locationCheckResult = await withResultAsync(async () => {
      await fs.access(location);
      assert(await isDirectory(location), `Install location is not a directory: ${location}`);
    });

    if (locationCheckResult.isErr()) {
      const { message } = locationCheckResult.error;
      this.log.error(message);
      this.updateStatus({ type: 'error', error: { message } });
      return;
    }

    // We only support Windows, Linux, and macOS on specific architectures
    const systemPlatform = process.platform;
    const systemArch = process.arch;
    assert(
      (systemPlatform === 'win32' && systemArch === 'x64') ||
        (systemPlatform === 'linux' && systemArch === 'x64') ||
        (systemPlatform === 'darwin' && systemArch === 'arm64'),
      `Unsupported platform: ${systemPlatform} ${systemArch}`
    );

    // The torch platform is determined by the GPU type, which in turn determines which pypi index to use
    const torchPlatform = getTorchPlatform(gpuType);

    // We only install xformers on 20xx and earlier Nvidia GPUs - otherwise, torch's native sdp is faster
    const withXformers = gpuType === 'nvidia<30xx';
    const invokeaiPackageSpecifier = withXformers ? 'invokeai[xformers]' : 'invokeai';

    this.log.info('Installation parameters:\r\n');
    this.log.info(`- Install location: ${location}\r\n`);
    this.log.info(`- GPU type: ${gpuType}\r\n`);
    this.log.info(`- Torch Platform: ${torchPlatform}\r\n`);

    if (repair) {
      this.log.info('Repair mode enabled:\r\n');
      this.log.info('- Force-reinstalling python\r\n');
      this.log.info('- Deleting and recreating virtual environment\r\n');
    }

    // Get the Python version and torch index URL for the target version
    const pinsResult = await withResult(() => getPins(version));

    if (pinsResult.isErr()) {
      this.log.error(`Failed to get pins for version ${version}: ${pinsResult.error.message}\r\n`);
      this.updateStatus({
        type: 'error',
        error: {
          message: 'Failed to get pins',
          context: serializeError(pinsResult.error),
        },
      });
      return;
    }

    const pythonVersion = pinsResult.value.python;
    const torchIndexUrl = pinsResult.value.torchIndexUrl[systemPlatform][torchPlatform];

    // Double-check that the UV executable exists and is a file - could be other problems but this is a good start
    const uvPath = getUVExecutablePath();
    const uvPathCheckResult = await withResultAsync(async () => {
      await fs.access(uvPath);
      assert(await isFile(uvPath), `UV executable is not a file: ${uvPath}`);
    });

    if (uvPathCheckResult.isErr()) {
      this.log.error(`Failed to access uv executable: ${uvPathCheckResult.error.message}\r\n`);
      this.updateStatus({
        type: 'error',
        error: {
          message: 'Failed to access uv executable',
          context: serializeError(uvPathCheckResult.error),
        },
      });
      return;
    }

    // Ready to start the installation process
    this.updateStatus({ type: 'installing' });

    // The install processes will log stdout/stderr with this, but it seems to be a toss of as to which messages
    // go to stdout and which to stderr. So we'll just log everything as info and handle actual errors separately
    const onOutput = (data: string) => {
      this.log.info(data);
    };

    const runProcessCallbacks = {
      onStdout: onOutput,
      onStderr: onOutput,
    };

    // Use an AbortController to cancel the installation process
    const abortController = new AbortController();
    this.abortController = abortController;

    const runProcessOptions = {
      signal: abortController.signal,
      env: process.env,
    };

    if (repair) {
      // In repair mode, we'll forcibly reinstall python
      const installPythonArgs = [
        // Use `uv`'s python interface to install the specific python version
        'python',
        'install',
        pythonVersion,
        // Always use a managed python version - never the system python
        '--python-preference',
        'only-managed',
        '--reinstall',
      ];

      this.log.info('Reinstalling Python...\r\n');
      this.log.info(`> ${uvPath} ${installPythonArgs.join(' ')}\r\n`);

      const installPythonResult = await withResultAsync(() =>
        runProcess(uvPath, installPythonArgs, runProcessCallbacks, runProcessOptions)
      );

      if (installPythonResult.isErr()) {
        this.log.error(`Failed to install Python: ${installPythonResult.error.message}\r\n`);
        this.logRepairModeMessages();
        this.updateStatus({
          type: 'error',
          error: {
            message: 'Failed to install Python',
            context: serializeError(installPythonResult.error),
          },
        });
        return;
      }

      if (installPythonResult.value === 'canceled') {
        this.log.warn('Installation canceled\r\n');
        this.updateStatus({ type: 'canceled' });
        return;
      }
    }

    // Create the virtual environment
    const venvPath = path.resolve(path.join(location, '.venv'));
    let hasVenv = await isDirectory(venvPath);

    // In repair mode, we will delete the .venv first if it exists
    if (repair && hasVenv) {
      this.log.info('Deleting existing virtual environment...\r\n');
      await fs.rm(venvPath, { recursive: true, force: true }).catch(() => {
        this.log.warn('Failed to delete virtual environment\r\n');
      });
      hasVenv = false;
    }

    /**
     * If the venv doesn't already exist, create it. Reasons why it might not exist:
     * - Fresh install.
     * - The user has deleted the virtual environment.
     * - We are running in repair mode, and just deleted it.
     * - A previous install attempt failed before the virtual environment was created.
     *
     * In any case, we need to create the virtual environment if it does not exist.
     *
     * TODO(psyche): Is there a way to check if the venv folder exists but is corrupted? Currently, we rely on the
     * app just breaking and the user learning to use repair mode to resolve the issue. Maybe this isn't a big deal.
     */
    if (!hasVenv) {
      const createVenvArgs = [
        // Use `uv`'s venv interface to create a virtual environment
        'venv',
        // We don't ever plan on relocating the venv but it doesn't hurt
        '--relocatable',
        // Note: the legacy install scripts used `.venv` as the prompt
        '--prompt',
        'invoke',
        // Ensure we install against the correct python version
        '--python',
        pythonVersion,
        // Always use a managed python version - never the system python. This installs the required python if it is not
        // already installed.
        '--python-preference',
        'only-managed',
        venvPath,
      ];

      this.log.info('Creating virtual environment...\r\n');
      this.log.info(`> ${uvPath} ${createVenvArgs.join(' ')}\r\n`);

      const createVenvResult = await withResultAsync(() =>
        runProcess(uvPath, createVenvArgs, runProcessCallbacks, runProcessOptions)
      );

      if (createVenvResult.isErr()) {
        this.log.error(`Failed to create virtual environment: ${createVenvResult.error.message}\r\n`);
        this.logRepairModeMessages();
        this.updateStatus({
          type: 'error',
          error: {
            message: 'Failed to create virtual environment',
            context: serializeError(createVenvResult.error),
          },
        });
        return;
      }

      if (createVenvResult.value === 'canceled') {
        this.log.warn('Installation canceled\r\n');
        this.updateStatus({ type: 'canceled' });
        return;
      }
    } else {
      this.log.info('Virtual environment already exists, skipping...\r\n');
    }

    // Install the invokeai package
    const installInvokeArgs = [
      // Use `uv`s pip interface to install the invokeai package
      'pip',
      'install',
      // Ensure we install against the correct python version
      '--python',
      pythonVersion,
      // Always use a managed python version - never the system python
      '--python-preference',
      'only-managed',
      `${invokeaiPackageSpecifier}==${version}`,
      // This may be unnecessary with `uv`, but we've had issues where `pip` screws up dependencies without --force-reinstall
      '--force-reinstall',
      // TODO(psyche): Last time I checked, this didn't seem to work - the bytecode wasn't compiled
      '--compile-bytecode',
    ];

    if (torchIndexUrl) {
      installInvokeArgs.push(`--index=${torchIndexUrl}`);
    }

    this.log.info('Installing invokeai package...\r\n');
    this.log.info(`> ${uvPath} ${installInvokeArgs.join(' ')}\r\n`);

    const installAppResult = await withResultAsync(() =>
      runProcess(uvPath, installInvokeArgs, runProcessCallbacks, { ...runProcessOptions, cwd: location })
    );

    if (installAppResult.isErr()) {
      this.log.error(`Failed to install invokeai python package: ${installAppResult.error.message}\r\n`);
      this.logRepairModeMessages();
      this.updateStatus({
        type: 'error',
        error: {
          message: 'Failed to install invokeai python package',
          context: serializeError(installAppResult.error),
        },
      });
      return;
    }

    if (installAppResult.value === 'canceled') {
      this.log.warn('Installation canceled\r\n');
      this.updateStatus({ type: 'canceled' });
      return;
    }

    // Create a marker file to indicate that the next run is the first run since installation.
    // The first run takes a while, presumably due to python bytecode compilation. When we run the app, we check
    // for this marker file and log a message if it exists. Once started up, we delete the marker file.
    const firstRunMarkerPath = join(location, FIRST_RUN_MARKER_FILENAME);
    fs.writeFile(firstRunMarkerPath, '').catch(() => {
      this.log.warn('Failed to create first run marker file\r\n');
    });

    // Hey it worked!
    this.updateStatus({ type: 'completed' });
    this.log.info('Installation completed successfully!\r\n');

    this.abortController = null;
  };

  cancelInstall = (): void => {
    if (!this.abortController) {
      this.log.warn('No installation to cancel\r\n');
      return;
    }

    if (this.abortController.signal.aborted) {
      this.log.warn('Installation already canceling\r\n');
      return;
    }

    this.log.warn('Canceling installation...\r\n');
    this.updateStatus({ type: 'canceling' });
    this.abortController.abort();
  };
}

/**
 * Helper function to create an `InstallManager` instance and set up IPC handlers for it. Returns the instance
 * and a cleanup function that should be called when the application is shutting down.
 */
export const createInstallManager = (arg: {
  ipc: IpcListener<IpcEvents>;
  sendToWindow: <T extends keyof IpcRendererEvents>(channel: T, ...args: IpcRendererEvents[T]) => void;
}) => {
  const { ipc, sendToWindow } = arg;

  const installManager = new InstallManager({
    ipcLogger: (entry) => {
      sendToWindow('install-process:log', entry);
    },
    onStatusChange: (status) => {
      sendToWindow('install-process:status', status);
    },
  });
  ipc.handle('install-process:start-install', (_, installationPath, gpuType, version, repair) => {
    installManager.startInstall(installationPath, gpuType, version, repair);
  });
  ipc.handle('install-process:cancel-install', () => {
    installManager.cancelInstall();
  });

  const cleanupInstallManager = () => {
    installManager.cancelInstall();
    ipcMain.removeHandler('install-process:start-install');
    ipcMain.removeHandler('install-process:cancel-install');
  };

  return [installManager, cleanupInstallManager] as const;
};

/**
 * Simple wrapper around `child_process.execFile` that returns a promise that resolves when the process exits with code 0.
 * If the process exits with a non-zero code, the promise is rejected with an error.
 *
 * @param file The path to the executable to run.
 * @param args The arguments to pass to the executable.
 * @param callbacks An object with `onStdout` and `onStderr` functions to handle the process's output. The output is passed as a string.
 * @param options Additional options to pass to `child_process.execFile`
 */
const runProcess = (
  file: string,
  args: string[],
  callbacks: {
    onStdout: (data: string) => void;
    onStderr: (data: string) => void;
  },
  options?: ObjectEncodingOptions & ExecFileOptions
): Promise<'success' | 'canceled'> => {
  return new Promise((resolve, reject) => {
    const p = execFile(file, args, options);

    p.on('error', (error) => {
      if (p.pid !== undefined) {
        // The process started but errored - handle this in the exit event
        return;
      }
      reject(error);
    });

    p.stdout?.on('data', (data) => {
      callbacks.onStdout(data.toString());
    });

    p.stderr?.on('data', (data) => {
      callbacks.onStderr(data.toString());
    });

    p.on('close', (code) => {
      if (code === 0) {
        resolve('success');
      } else if (code === null) {
        // The process was killed via signal
        resolve('canceled');
      } else {
        // The process exited with a non-zero code
        reject(new Error(`Process exited with code ${code}`));
      }
    });
  });
};
