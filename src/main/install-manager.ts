import type { IpcListener } from '@electron-toolkit/typed-ipc/main';
import { major, minor } from '@renovatebot/pep440';
import c from 'ansi-colors';
import { ipcMain } from 'electron';
import fs from 'fs/promises';
import path, { join } from 'path';
import { serializeError } from 'serialize-error';
import { assert } from 'tsafe';

import { CommandRunner } from '@/lib/command-runner';
import { DEFAULT_ENV } from '@/lib/pty-utils';
import { withResultAsync } from '@/lib/result';
import { SimpleLogger } from '@/lib/simple-logger';
import { FIRST_RUN_MARKER_FILENAME } from '@/main/constants';
import { getInstallationDetails, getTorchPlatform, getUVExecutablePath, isDirectory, isFile } from '@/main/util';
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
  private ipcRawOutput: (data: string) => void;
  private onStatusChange: (status: WithTimestamp<InstallProcessStatus>) => void;
  private log: SimpleLogger;
  private commandRunner: CommandRunner;
  private cols: number | undefined;
  private rows: number | undefined;
  private isCancellationRequested: boolean;

  constructor(arg: {
    ipcLogger: InstallManager['ipcLogger'];
    ipcRawOutput: InstallManager['ipcRawOutput'];
    onStatusChange: InstallManager['onStatusChange'];
  }) {
    this.ipcLogger = arg.ipcLogger;
    this.ipcRawOutput = arg.ipcRawOutput;
    this.onStatusChange = arg.onStatusChange;
    this.commandRunner = new CommandRunner({ maxHistorySize: 1000 });
    this.status = { type: 'uninitialized', timestamp: Date.now() };
    this.log = new SimpleLogger((entry) => {
      this.ipcRawOutput(entry.message);
      console[entry.level](entry.message);
    });
    this.isCancellationRequested = false;
  }

  logRepairModeMessages = (): void => {
    this.log.info('Try installing again with Repair mode enabled to fix this.\r\n');
    this.log.info('Ask for help on Discord or GitHub if you continue to have issues.\r\n');
  };

  /**
   * Run a command using PTY for proper terminal emulation
   */
  private runCommand = async (
    command: string,
    args: string[],
    options?: { cwd?: string; env?: Record<string, string> }
  ): Promise<'success' | 'canceled'> => {
    // Check if cancellation was already requested
    if (this.isCancellationRequested) {
      return 'canceled';
    }

    try {
      const result = await this.commandRunner.runCommand(
        command,
        args,
        {
          cwd: options?.cwd,
          env: options?.env,
          rows: this.rows,
          cols: this.cols,
        },
        {
          onData: (data) => {
            // Write command output to XTerm
            this.ipcRawOutput(data);
            // Write command output to NodeJS console
            process.stdout.write(data);
          },
        }
      );

      // Check if this was a cancellation (typically SIGTERM results in exit code 143)
      if (this.isCancellationRequested) {
        return 'canceled';
      }

      if (result.exitCode === 0) {
        return 'success';
      } else {
        throw new Error(`Process exited with code ${result.exitCode}`);
      }
    } catch (error) {
      if (this.isCancellationRequested) {
        return 'canceled';
      }
      throw error;
    }
  };

  /**
   * Resize the current PTY if one is active
   */
  resizePty = (cols: number, rows: number): void => {
    this.cols = cols;
    this.rows = rows;
    this.commandRunner.resize(cols, rows);
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

    // Reset cancellation flag at the start of a new installation
    this.isCancellationRequested = false;
    this.updateStatus({ type: 'starting' });
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

    // Get the Python version and torch index URL for the target version
    const pinsResult = await withResultAsync(() => getPins(version));

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

    const installationDetails = await getInstallationDetails(location);

    let pythonVersionMismatch = false;

    if (installationDetails.isInstalled) {
      this.log.info(c.cyan(`Detected existing installation at ${location}:\r\n`));
      this.log.info(`- Invoke version: ${installationDetails.version}\r\n`);
      this.log.info(`- Python version: ${installationDetails.pythonVersion}\r\n`);

      // If the existing installation has a different python version than is required for this version of Invoke,
      // we (re)install python.
      const majorVersionMatch = major(installationDetails.pythonVersion) === major(pythonVersion);
      const minorVersionMatch = minor(installationDetails.pythonVersion) === minor(pythonVersion);

      if (!majorVersionMatch || !minorVersionMatch) {
        pythonVersionMismatch = true;
      }
    } else {
      pythonVersionMismatch = true;
    }

    this.log.info(c.cyan('Installation parameters:\r\n'));
    this.log.info(`- Invoke version: ${version}\r\n`);
    this.log.info(`- Install location: ${location}\r\n`);
    this.log.info(`- Python version: ${pythonVersion}\r\n`);
    this.log.info(`- GPU type: ${gpuType}\r\n`);
    this.log.info(`- Torch platform: ${torchPlatform}\r\n`);
    this.log.info(`- Using torch index: ${torchIndexUrl ?? 'default'}\r\n`);

    if (repair) {
      this.log.info(c.magenta('Repair mode enabled:\r\n'));
      this.log.info('- Force-reinstalling python\r\n');
      this.log.info('- Deleting and recreating virtual environment\r\n');
    }

    // Double-check that the UV executable exists and is a file - could be other problems but this is a good start
    const uvPath = getUVExecutablePath();
    const uvPathCheckResult = await withResultAsync(async () => {
      await fs.access(uvPath);
      assert(await isFile(uvPath), `UV executable is not a file: ${uvPath}`);
    });

    if (uvPathCheckResult.isErr()) {
      this.log.error(c.red(`Failed to access uv executable: ${uvPathCheckResult.error.message}\r\n`));
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

    // Clean up any previous command if it exists
    if (this.commandRunner.isRunning()) {
      this.commandRunner.kill();
    }

    const runProcessOptions = {
      env: { ...process.env, ...DEFAULT_ENV } as Record<string, string>,
    };

    if (repair || pythonVersionMismatch) {
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

      this.log.info(c.cyan(`Installing Python ${pythonVersion}...\r\n`));
      this.log.info(`> ${uvPath} ${installPythonArgs.join(' ')}\r\n`);

      const installPythonResult = await withResultAsync(() =>
        this.runCommand(uvPath, installPythonArgs, runProcessOptions)
      );

      if (installPythonResult.isErr()) {
        this.log.error(c.red(`Failed to install Python: ${installPythonResult.error.message}\r\n`));
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
        this.log.warn(c.yellow('Installation canceled\r\n'));
        this.updateStatus({ type: 'canceled' });
        return;
      }
    }

    // Check for cancellation before proceeding to venv creation
    if (this.isCancellationRequested) {
      this.log.warn(c.yellow('Installation canceled\r\n'));
      this.updateStatus({ type: 'canceled' });
      return;
    }

    // Create the virtual environment
    const venvPath = path.resolve(path.join(location, '.venv'));
    let hasVenv = await isDirectory(venvPath);

    // In repair mode, we will delete the .venv first if it exists
    if ((repair || pythonVersionMismatch) && hasVenv) {
      this.log.info(c.cyan('Deleting existing virtual environment...\r\n'));
      await fs.rm(venvPath, { recursive: true, force: true }).catch(() => {
        this.log.warn(c.yellow('Failed to delete virtual environment\r\n'));
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

      this.log.info(c.cyan('Creating virtual environment...\r\n'));
      this.log.info(`> ${uvPath} ${createVenvArgs.join(' ')}\r\n`);

      const createVenvResult = await withResultAsync(() => this.runCommand(uvPath, createVenvArgs, runProcessOptions));

      if (createVenvResult.isErr()) {
        this.log.error(c.red(`Failed to create virtual environment: ${createVenvResult.error.message}\r\n`));
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
        this.log.warn(c.yellow('Installation canceled\r\n'));
        this.updateStatus({ type: 'canceled' });
        return;
      }
    } else {
      this.log.info(c.cyan('Using existing virtual environment...\r\n'));
    }

    // Check for cancellation before proceeding to package installation
    if (this.isCancellationRequested) {
      this.log.warn(c.yellow('Installation canceled\r\n'));
      this.updateStatus({ type: 'canceled' });
      return;
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

    // Manually set the VIRTUAL_ENV environment variable to the venv path to ensure `uv` uses it correctly.
    // Unfortunately there is no way to specify this in the `uv` CLI.
    runProcessOptions.env.VIRTUAL_ENV = venvPath;

    this.log.info(c.cyan('Installing invokeai package...\r\n'));
    this.log.info(`> ${uvPath} ${installInvokeArgs.join(' ')}\r\n`);

    const installAppResult = await withResultAsync(() =>
      this.runCommand(uvPath, installInvokeArgs, { ...runProcessOptions, cwd: location })
    );

    if (installAppResult.isErr()) {
      this.log.error(c.red(`Failed to install invokeai python package: ${installAppResult.error.message}\r\n`));
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
      this.log.warn(c.yellow('Installation canceled\r\n'));
      this.updateStatus({ type: 'canceled' });
      return;
    }

    // Create a marker file to indicate that the next run is the first run since installation.
    // The first run takes a while, presumably due to python bytecode compilation. When we run the app, we check
    // for this marker file and log a message if it exists. Once started up, we delete the marker file.
    const firstRunMarkerPath = join(location, FIRST_RUN_MARKER_FILENAME);
    fs.writeFile(firstRunMarkerPath, '').catch(() => {
      this.log.warn(c.yellow('Failed to create first run marker file\r\n'));
    });

    // Hey it worked!
    this.updateStatus({ type: 'completed' });
    this.log.info(c.green.bold('Installation completed successfully\r\n'));
  };

  cancelInstall = (): void => {
    // Check if an installation is actually in progress
    const installInProgress = this.status.type === 'installing' || this.status.type === 'starting';

    if (!installInProgress) {
      this.log.warn(c.yellow('No installation to cancel\r\n'));
      return;
    }

    // Set the cancellation flag
    this.isCancellationRequested = true;

    this.log.warn(c.yellow('Canceling installation...\r\n'));
    this.updateStatus({ type: 'canceling' });

    // If there's a current command running, kill it
    if (this.commandRunner.isRunning()) {
      this.commandRunner.kill();
    }
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
    ipcRawOutput: (data) => {
      sendToWindow('install-process:raw-output', data);
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
  ipc.handle('install-process:resize', (_, cols, rows) => {
    installManager.resizePty(cols, rows);
  });

  const cleanupInstallManager = () => {
    installManager.cancelInstall();
    ipcMain.removeHandler('install-process:start-install');
    ipcMain.removeHandler('install-process:cancel-install');
    ipcMain.removeHandler('install-process:resize');
  };

  return [installManager, cleanupInstallManager] as const;
};
