import type { IpcListener } from '@electron-toolkit/typed-ipc/main';
import { compare, major, minor } from '@renovatebot/pep440';
import c from 'ansi-colors';
import { ipcMain } from 'electron';
import fs from 'fs/promises';
import path, { join } from 'path';
import { serializeError } from 'serialize-error';
import { shellEnvSync } from 'shell-env';
import { assert } from 'tsafe';

import { CommandRunner } from '@/lib/command-runner';
import { DEFAULT_ENV } from '@/lib/pty-utils';
import { withResultAsync } from '@/lib/result';
import { SimpleLogger } from '@/lib/simple-logger';
import { FIRST_RUN_MARKER_FILENAME } from '@/main/constants';
import { getInstallationDetails, getTorchPlatform, getUVExecutablePath, isDirectory, isFile } from '@/main/util';
import type { InvokeReleaseInstallFiles } from '@/shared/pins';
import { getInvokeReleaseInstallFiles, getPins, getTorchPackagesFromLock } from '@/shared/pins';
import type {
  GpuType,
  InstallProcessStatus,
  IpcEvents,
  IpcRendererEvents,
  LogEntry,
  WithTimestamp,
} from '@/shared/types';
import { isCustomTorchIndexUrlInvalid, redactUrlCredentials } from '@/shared/url';

const BOOTSTRAP_PROJECT_DIR_NAME = '.launcher-bootstrap';
const MIN_BOOTSTRAP_INSTALL_VERSION = '6.14.0rc1';

const shouldUseBootstrapInstall = (version: string): boolean => {
  return compare(version.replace(/^v/, ''), MIN_BOOTSTRAP_INSTALL_VERSION) >= 0;
};

const getInvokeExtras = (gpuType: GpuType, torchPlatform: 'cuda' | 'rocm' | 'cpu' | null): string[] => {
  const extras: string[] = [];

  if (torchPlatform && process.platform !== 'darwin') {
    extras.push(torchPlatform);
  }

  // We only install xformers on 20xx and earlier Nvidia GPUs - otherwise, torch's native sdp is faster
  if (gpuType === 'nvidia<30xx') {
    extras.push('xformers');
  }

  return extras;
};

const getInvokePackageSpecifier = (version: string, extras: string[]): string => {
  const extrasSpecifier = extras.length > 0 ? `[${extras.join(',')}]` : '';
  return `invokeai${extrasSpecifier}==${version}`;
};

const getDeclaredOptionalDependencies = (pyprojectToml: string): Set<string> => {
  const match = pyprojectToml.match(/\n\[project\.optional-dependencies\]\s*([\s\S]*?)(?=\n\[|\n#===|$)/);
  const optionalDependencies = match?.[1];
  if (!optionalDependencies) {
    return new Set();
  }

  return new Set(
    [...optionalDependencies.matchAll(/^"?([\w-]+)"?\s*=/gm)]
      .map((extra) => extra[1])
      .filter((extra): extra is string => Boolean(extra))
  );
};

const writeBootstrapProject = async (arg: {
  location: string;
  releaseFiles: InvokeReleaseInstallFiles;
}): Promise<string> => {
  const bootstrapProjectPath = path.resolve(path.join(arg.location, BOOTSTRAP_PROJECT_DIR_NAME));
  await fs.rm(bootstrapProjectPath, { recursive: true, force: true });
  await fs.mkdir(bootstrapProjectPath, { recursive: true });

  await Promise.all([
    fs.writeFile(path.join(bootstrapProjectPath, 'pyproject.toml'), arg.releaseFiles.pyprojectToml),
    fs.writeFile(path.join(bootstrapProjectPath, 'uv.lock'), arg.releaseFiles.uvLock),
  ]);

  return bootstrapProjectPath;
};

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
    this.commandRunner = new CommandRunner();
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

  startInstall = async (
    location: string,
    gpuType: GpuType,
    version: string,
    customTorchIndexUrl?: string,
    repair?: boolean
  ) => {
    // Normalize the optional custom torch index override: an empty/whitespace value means "use defaults".
    const torchIndexOverride = customTorchIndexUrl?.trim() || undefined;

    // Defense-in-depth: the renderer already rejects non-http(s) URLs at entry, but the main process should not trust
    // that. A bad value here would otherwise surface as a cryptic uv error minutes into the install.
    if (torchIndexOverride && isCustomTorchIndexUrlInvalid(torchIndexOverride)) {
      const message = `Invalid custom torch index URL: ${redactUrlCredentials(torchIndexOverride)}`;
      this.log.error(c.red(`${message}\r\n`));
      this.updateStatus({ type: 'error', error: { message } });
      return;
    }

    // Any credentials embedded in the override must never be echoed into the install log or the surfaced command lines.
    const redactedTorchIndexOverride = torchIndexOverride ? redactUrlCredentials(torchIndexOverride) : undefined;
    const redactForLog = (text: string): string =>
      torchIndexOverride && redactedTorchIndexOverride
        ? text.split(torchIndexOverride).join(redactedTorchIndexOverride)
        : text;
    /**
     * Installation is a 2-step process:
     * - Create a virtual environment.
     * - Generate a bootstrap project from the selected Invoke release and sync it into the virtual environment.
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

    // The torch platform is determined by the GPU type, which in turn determines which torch extra and index to use
    const torchPlatform = getTorchPlatform(gpuType);
    const useBootstrapInstall = shouldUseBootstrapInstall(version);
    let invokeExtras = getInvokeExtras(gpuType, useBootstrapInstall ? torchPlatform : null);

    const bootstrapProjectPath = path.resolve(path.join(location, BOOTSTRAP_PROJECT_DIR_NAME));
    await fs.rm(bootstrapProjectPath, { recursive: true, force: true }).catch(() => {
      this.log.warn(c.yellow('Failed to delete previous bootstrap project\r\n'));
    });

    let releaseFiles: InvokeReleaseInstallFiles | null = null;
    let pins: Awaited<ReturnType<typeof getPins>>;

    if (useBootstrapInstall) {
      // Get the selected Invoke release's install metadata. For Invoke 6.14.0+, the bootstrap project uses the release
      // pyproject.toml and lockfile to sync dependencies, then installs the published invokeai package for the selected
      // version. Older versions use the legacy pip install path.
      const releaseFilesResult = await withResultAsync(() => getInvokeReleaseInstallFiles(version));

      if (releaseFilesResult.isErr()) {
        this.log.error(
          `Failed to get Invoke release install files for version ${version}: ${releaseFilesResult.error.message}\r\n`
        );
        this.updateStatus({
          type: 'error',
          error: {
            message: 'Failed to get Invoke release install files',
            context: serializeError(releaseFilesResult.error),
          },
        });
        return;
      }

      releaseFiles = releaseFilesResult.value;
      pins = releaseFiles.pins;
      const declaredExtras = getDeclaredOptionalDependencies(releaseFiles.pyprojectToml);
      const omittedExtras = invokeExtras.filter((extra) => !declaredExtras.has(extra));
      invokeExtras = invokeExtras.filter((extra) => declaredExtras.has(extra));

      if (omittedExtras.length > 0) {
        this.log.warn(c.yellow(`Skipping undefined Invoke package extras: ${omittedExtras.join(', ')}\r\n`));
      }
    } else {
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

      pins = pinsResult.value;
    }

    const invokeaiPackageSpecifier = getInvokePackageSpecifier(version, invokeExtras);
    const pythonVersion = pins.python;

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
    this.log.info(`- Invoke package: ${invokeaiPackageSpecifier}\r\n`);
    this.log.info(
      `- Dependency resolution: ${
        useBootstrapInstall ? 'frozen Invoke pyproject.toml and uv.lock' : 'legacy package metadata install'
      }\r\n`
    );
    if (torchIndexOverride) {
      this.log.info(c.magenta(`- Torch index override: ${redactedTorchIndexOverride}\r\n`));

      // xformers (installed only on nvidia<30xx) is pulled from Invoke's default index and built against the lock's
      // default CUDA torch. If the user swaps torch to a different CUDA build via the override, the two can have
      // mismatched ABIs, which is a known source of import errors or crashes. Warn, but don't block - the user opted in.
      if (invokeExtras.includes('xformers')) {
        this.log.warn(
          c.yellow(
            '- Warning: a custom torch index is combined with the xformers extra (20xx-series cards). xformers is built ' +
              "against Invoke's default CUDA torch, so a mismatched custom CUDA build may cause import errors or " +
              'crashes.\r\n'
          )
        );
      }
    }

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
      env: { ...process.env, ...DEFAULT_ENV, ...shellEnvSync() } as Record<string, string>,
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

    // Manually set the VIRTUAL_ENV environment variable to the venv path to ensure `uv` uses it correctly.
    runProcessOptions.env.VIRTUAL_ENV = venvPath;

    let installInvokeArgs: string[];

    if (useBootstrapInstall) {
      assert(releaseFiles, 'Bootstrap install requires release files');

      const bootstrapProjectResult = await withResultAsync(() =>
        writeBootstrapProject({
          location,
          releaseFiles,
        })
      );

      if (bootstrapProjectResult.isErr()) {
        this.log.error(c.red(`Failed to create bootstrap project: ${bootstrapProjectResult.error.message}\r\n`));
        this.updateStatus({
          type: 'error',
          error: {
            message: 'Failed to create bootstrap project',
            context: serializeError(bootstrapProjectResult.error),
          },
        });
        return;
      }

      const bootstrapProjectPath = bootstrapProjectResult.value;

      // When a custom torch index is set, we install the torch-family packages from that index instead of the source
      // the lockfile records. To avoid downloading torch twice (once from the lock during `uv sync`, once from the
      // custom index afterwards), we skip those packages during the sync and install them once from the custom index
      // below. `uv sync --frozen` cannot pull them from a different index in-place, so a separate install is required.
      const torchPackages = torchIndexOverride ? getTorchPackagesFromLock(releaseFiles.uvLock, torchPlatform) : [];

      const syncInvokeArgs = [
        // Use `uv sync` against the selected Invoke release's pyproject.toml and lockfile.
        'sync',
        '--project',
        bootstrapProjectPath,
        // The generated project is only a dependency resolver. Do not install it into the app venv.
        '--no-install-project',
        // Sync into the venv we created above, rather than creating a venv under the bootstrap project.
        '--active',
        // Do not remove user-installed packages from the app venv.
        '--inexact',
        // The selected Invoke release's uv.lock should be authoritative.
        '--frozen',
        // Ensure we sync against the correct python version.
        '--python',
        pythonVersion,
        // Always use a managed python version - never the system python.
        '--python-preference',
        'only-managed',
        '--compile-bytecode',
      ];

      for (const extra of invokeExtras) {
        syncInvokeArgs.push('--extra', extra);
      }

      // Skip the torch-family packages during sync - they are reinstalled from the custom index below.
      for (const pkg of torchPackages) {
        syncInvokeArgs.push('--no-install-package', pkg.name);
      }

      this.log.info(c.cyan('Syncing invokeai environment...\r\n'));
      this.log.info(`> VIRTUAL_ENV=${venvPath} ${uvPath} ${syncInvokeArgs.join(' ')}\r\n`);

      const syncEnvResult = await withResultAsync(() =>
        this.runCommand(uvPath, syncInvokeArgs, { ...runProcessOptions, cwd: bootstrapProjectPath })
      );

      if (syncEnvResult.isErr()) {
        this.log.error(c.red(`Failed to sync invokeai environment: ${syncEnvResult.error.message}\r\n`));
        this.logRepairModeMessages();
        this.updateStatus({
          type: 'error',
          error: {
            message: 'Failed to sync invokeai environment',
            context: serializeError(syncEnvResult.error),
          },
        });
        return;
      }

      if (syncEnvResult.value === 'canceled') {
        this.log.warn(c.yellow('Installation canceled\r\n'));
        this.updateStatus({ type: 'canceled' });
        return;
      }

      // Check for cancellation before proceeding to package installation
      if (this.isCancellationRequested) {
        this.log.warn(c.yellow('Installation canceled\r\n'));
        this.updateStatus({ type: 'canceled' });
        return;
      }

      // If a custom torch index is set, install the torch-family packages from it. These were skipped during `uv sync`
      // (see `--no-install-package` above), so this is a single download from the user's index rather than a second
      // one. This deliberately departs from the lock's recorded source - which is exactly what the user is asking for
      // when they set the field (e.g. cu126 on 20xx cards, ROCm on Windows).
      if (torchIndexOverride) {
        if (torchPackages.length === 0) {
          this.log.warn(
            c.yellow(
              `Custom torch index is set, but no ${torchPlatform} torch packages were found in the Invoke release lockfile - skipping the torch install from the custom index.\r\n`
            )
          );
        } else {
          const reinstallTorchArgs = [
            'pip',
            'install',
            '--python',
            venvPath,
            '--python-preference',
            'only-managed',
            // Pull the torch packages from the user-provided index *instead of* PyPI, not in addition to it. `--index`
            // only *prepends* an index, so uv silently falls back to the default PyPI wheel when the custom index lacks
            // the pinned (tag-stripped) version - installing the wrong backend with no error, the exact failure this
            // feature prevents. `--index-url` makes the custom index the sole index, so a mismatch fails loudly. This is
            // safe here because the step is `--no-deps` and requests only the torch-family packages.
            `--index-url=${torchIndexOverride}`,
            // The torch packages were skipped during sync; on a reinstall/update an older build may still be present,
            // so force the install to guarantee the packages come from the custom index.
            '--force-reinstall',
            // Everything else is already installed by `uv sync`; only install the torch packages themselves.
            '--no-deps',
            '--compile-bytecode',
            ...torchPackages.map(({ name, version }) => `${name}==${version}`),
          ];

          this.log.info(c.cyan('Installing torch from custom index...\r\n'));
          this.log.info(redactForLog(`> VIRTUAL_ENV=${venvPath} ${uvPath} ${reinstallTorchArgs.join(' ')}\r\n`));

          const reinstallTorchResult = await withResultAsync(() =>
            this.runCommand(uvPath, reinstallTorchArgs, { ...runProcessOptions, cwd: location })
          );

          if (reinstallTorchResult.isErr()) {
            this.log.error(
              c.red(`Failed to reinstall torch from custom index: ${reinstallTorchResult.error.message}\r\n`)
            );
            this.updateStatus({
              type: 'error',
              error: {
                message: 'Failed to reinstall torch from custom index',
                context: serializeError(reinstallTorchResult.error),
              },
            });
            return;
          }

          if (reinstallTorchResult.value === 'canceled') {
            this.log.warn(c.yellow('Installation canceled\r\n'));
            this.updateStatus({ type: 'canceled' });
            return;
          }
        }
      }

      installInvokeArgs = [
        // Install the published Invoke package after syncing its locked dependencies. Dependencies are installed by
        // `uv sync` above, so do not resolve them again from wheel metadata.
        'pip',
        'install',
        '--python',
        venvPath,
        '--python-preference',
        'only-managed',
        '--no-deps',
        '--force-reinstall',
        '--compile-bytecode',
        `${invokeaiPackageSpecifier}`,
      ];
    } else {
      installInvokeArgs = [
        // Use `uv`s pip interface to install the invokeai package
        'pip',
        'install',
        // Ensure we install against the correct python version
        '--python',
        pythonVersion,
        // Always use a managed python version - never the system python
        '--python-preference',
        'only-managed',
        `${invokeaiPackageSpecifier}`,
        // This may be unnecessary with `uv`, but we've had issues where `pip` screws up dependencies without
        // --force-reinstall
        '--force-reinstall',
        // TODO(psyche): Last time I checked, this didn't seem to work - the bytecode wasn't compiled
        '--compile-bytecode',
      ];

      const torchIndexUrl = torchIndexOverride ?? pins.torchIndexUrl[systemPlatform][torchPlatform];
      if (torchIndexUrl) {
        installInvokeArgs.push(`--index=${torchIndexUrl}`);
      }
    }

    this.log.info(c.cyan('Installing invokeai package...\r\n'));
    this.log.info(redactForLog(`> VIRTUAL_ENV=${venvPath} ${uvPath} ${installInvokeArgs.join(' ')}\r\n`));

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

  /**
   * Cancel any running installation and wait for process to exit
   */
  cancelInstall = async (): Promise<void> => {
    // Check if an installation is actually in progress
    const installInProgress = this.status.type === 'installing' || this.status.type === 'starting';

    if (!installInProgress) {
      this.log.debug('No installation to cancel\r\n');
      return;
    }

    // Set the cancellation flag
    this.isCancellationRequested = true;

    this.log.warn(c.yellow('Canceling installation...\r\n'));
    this.updateStatus({ type: 'canceling' });

    // If there's a current command running, kill it and wait
    if (this.commandRunner.isRunning()) {
      await this.commandRunner.kill();
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

  ipc.handle('install-process:start-install', (_, installationPath, gpuType, version, customTorchIndexUrl, repair) => {
    installManager.startInstall(installationPath, gpuType, version, customTorchIndexUrl, repair);
  });
  ipc.handle('install-process:cancel-install', async () => {
    await installManager.cancelInstall();
  });
  ipc.handle('install-process:resize', (_, cols, rows) => {
    installManager.resizePty(cols, rows);
  });

  const cleanupInstallManager = async () => {
    await installManager.cancelInstall();
    ipcMain.removeHandler('install-process:start-install');
    ipcMain.removeHandler('install-process:cancel-install');
    ipcMain.removeHandler('install-process:resize');
  };

  return [installManager, cleanupInstallManager] as const;
};
