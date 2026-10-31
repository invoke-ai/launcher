import type { ChildProcess } from 'child_process';
import { exec, execFile, execFileSync } from 'child_process';
import type { BrowserWindow } from 'electron';
import { app, screen } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';

import { withResultAsync } from '@/lib/result';
import type { DirDetails, GpuType, OperatingSystem, SystemArch, WindowProps } from '@/shared/types';

const execAsync = promisify(exec);

//#region Platform

export const getOperatingSystem = (): OperatingSystem => {
  if (process.platform === 'win32') {
    return 'Windows';
  } else if (process.platform === 'darwin') {
    return 'macOS';
  } else {
    return 'Linux';
  }
};

type WindowsArchProbe = {
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  env: NodeJS.ProcessEnv;
  /** The machine's native `PROCESSOR_ARCHITECTURE` from the registry, or `undefined` if it could not be read. */
  readNativeArch: () => string | undefined;
};

/**
 * Read the machine's `PROCESSOR_ARCHITECTURE` system variable from the registry.
 *
 * Windows rewrites the *process* environment for an emulated x64 process to `PROCESSOR_ARCHITECTURE=AMD64` (and sets
 * `PROCESSOR_ARCHITEW6432` only for 32-bit x86 processes under WOW64), so the environment cannot tell an x64 launcher
 * that it is running on ARM64. The system variable it is derived from is stored, unmodified, under `HKLM\SYSTEM`,
 * which is shared by every architecture's registry view.
 */
const readNativeArchFromRegistry = (): string | undefined => {
  try {
    const regPath = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'reg.exe');
    const stdout = execFileSync(
      regPath,
      [
        'query',
        'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
        '/v',
        'PROCESSOR_ARCHITECTURE',
      ],
      { encoding: 'utf8', timeout: 5000, windowsHide: true }
    );
    return stdout.match(/PROCESSOR_ARCHITECTURE\s+REG_\w+\s+(\S+)/)?.[1];
  } catch {
    return undefined;
  }
};

/**
 * Whether this machine is Windows on ARM64, given the process's view of itself. Exported for tests; use
 * `isWindowsArm64`.
 *
 * `process.arch` names the launcher binary's architecture, not the machine's: an x64 launcher running under Windows'
 * emulation reports `x64`, and so does its environment. Only when the binary is not native ARM64 is the registry
 * consulted for the machine's architecture.
 */
export const detectWindowsArm64 = ({ platform, arch, env, readNativeArch }: WindowsArchProbe): boolean => {
  if (platform !== 'win32') {
    return false;
  }
  if (arch === 'arm64') {
    return true;
  }
  const envMachine = env.PROCESSOR_ARCHITEW6432 ?? env.PROCESSOR_ARCHITECTURE ?? '';
  if (envMachine.toUpperCase() === 'ARM64') {
    return true;
  }
  return readNativeArch()?.toUpperCase() === 'ARM64';
};

let cachedIsWindowsArm64: boolean | undefined;

/**
 * Whether this machine is Windows on ARM64, including when this launcher is the x64 build running under emulation.
 * Getting this right matters because an x86_64 Python cannot load the ARM64 torch wheel, so an emulated launcher must
 * still request the native interpreter. The machine cannot change architecture while the launcher runs, so the
 * answer (which may cost a `reg.exe` call) is computed once.
 */
export const isWindowsArm64 = (): boolean => {
  if (cachedIsWindowsArm64 === undefined) {
    cachedIsWindowsArm64 = detectWindowsArm64({
      platform: process.platform,
      arch: process.arch,
      env: process.env,
      readNativeArch: readNativeArchFromRegistry,
    });
  }
  return cachedIsWindowsArm64;
};

export const getSystemArch = (): SystemArch => {
  if (isWindowsArm64()) {
    return 'arm64';
  }
  switch (process.arch) {
    case 'x64':
      return 'x64';
    case 'arm64':
      return 'arm64';
    default:
      return 'other';
  }
};

/**
 * The interpreter to ask uv for, given the `major.minor` version pinned by the Invoke release.
 *
 * A bare version ("3.12") makes uv install an x86_64 CPython on Windows ARM64, which cannot load the ARM64 torch
 * wheel; the fully qualified request names the native build. Everywhere else the bare version is what the launcher
 * has always passed.
 */
export const getPythonRequest = (pythonVersion: string): string => {
  return isWindowsArm64() ? `cpython-${pythonVersion}-windows-aarch64-none` : pythonVersion;
};

/**
 * Get the path to the bundled bin directory. This directory holds executables that are bundled with the app. These
 * resources are extracted at runtime and deleted when the app is closed - do not store anything important here.
 */
export const getBundledBinPath = (): string => {
  if (isDevelopment()) {
    // In development, resolve from project root
    return path.resolve(path.join(__dirname, '..', '..', 'assets', 'bin'));
  } else {
    // In production, assets are copied to the resources directory
    return path.resolve(path.join(process.resourcesPath, 'bin'));
  }
};

/**
 * Get the path to the uv executable
 */
export const getUVExecutablePath = (): string => {
  const uvName = process.platform === 'win32' ? 'uv.exe' : 'uv';
  return path.join(getBundledBinPath(), uvName);
};

/**
 * Gets the path to the invoke executable in the given installation location
 */
const getInvokeExecPath = (installLocation: string): string => {
  return process.platform === 'win32'
    ? path.join(installLocation, '.venv', 'Scripts', 'invokeai-web.exe')
    : path.join(installLocation, '.venv', 'bin', 'invokeai-web');
};

/**
 * Gets the path to the `activate` executable in the given installation location
 */
const getActivateVenvPath = (installLocation: string): string => {
  return process.platform === 'win32'
    ? path.join(installLocation, '.venv', 'Scripts', 'Activate.ps1')
    : path.join(installLocation, '.venv', 'bin', 'activate');
};

export const getActivateVenvCommand = (installLocation: string): string => {
  const activateVenvPath = getActivateVenvPath(installLocation);
  return process.platform === 'win32' ? `& "${activateVenvPath}"` : `source "${activateVenvPath}"`;
};

/**
 * Gets the torch platform to install for a given GPU type on this operating system.
 *
 * This is the single place the platform x accelerator support matrix lives: a GPU type whose accelerator has no torch
 * build on this OS resolves to `cpu`, because that is what the user is actually going to get. Deciding it here rather
 * than letting it fall out of a missing index or an extra that resolves to nothing keeps the install honest - the
 * logged torch platform, the requested extra and the installed wheel all agree, and the guards further down do not
 * have to distinguish "this release is too old" from "this never works here".
 *
 * - macOS: always `cpu`. PyTorch has no separate index for MPS; the CPU wheels carry it.
 * - Windows + AMD: `cpu`. There is no ROCm build of torch for Windows, which is exactly what the GPU confirmation step
 *   tells the user before they get here.
 * - Windows ARM64 + Intel: `cpu`. PyTorch's +xpu wheels are x64 only. (On Windows ARM64 the Invoke lockfile installs
 *   NVIDIA's torch build for every extra, `cpu` included, so the extra only has to exist.)
 *
 * @param gpuType The GPU type
 * @returns The torch platform corresponding to the GPU type
 */
export const getTorchPlatform = (gpuType: GpuType): 'cuda' | 'rocm' | 'xpu' | 'cpu' => {
  if (process.platform === 'darwin') {
    // macOS uses MPS, but we don't need to provide a separate option for this because pytorch doesn't have a separate index url for MPS
    return 'cpu';
  } else {
    switch (gpuType) {
      case 'amd':
        return process.platform === 'win32' ? 'cpu' : 'rocm';
      case 'intel':
        // Intel's XPU backend. PyTorch publishes +xpu wheels for linux-x86_64 and windows-amd64 only.
        return isWindowsArm64() ? 'cpu' : 'xpu';
      case 'nvidia<30xx':
      case 'nvidia>=30xx':
        return 'cuda';
      case 'nogpu':
        return 'cpu';
      default:
        // Default to cuda because in reality this is the most common gpu type at the moment
        return 'cuda';
    }
  }
};

//#endregion

//#region Filesystem

/**
 * Get the path to the user's home directory
 * @returns The path to the user's home directory
 */
export const getHomeDirectory = (): string => app.getPath('home');

/**
 * Check if a path is a directory
 * @param path The path to check
 * @returns Whether the path is a directory
 */
export const isDirectory = async (path: string): Promise<boolean> => {
  try {
    const stats = await fs.stat(path);
    return stats.isDirectory();
  } catch {
    return false;
  }
};

/**
 * Check if a path is a file
 * @param path The path to check
 * @returns Whether the path is a file
 */
export const isFile = async (path: string): Promise<boolean> => {
  try {
    const stats = await fs.stat(path);
    return stats.isFile();
  } catch {
    return false;
  }
};

/**
 * Check if a path exists
 * @param path The path to check
 * @returns Whether the path exists
 */
export const pathExists = async (path: string): Promise<boolean> => {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
};

const getPythonPathForVenv = (venvPath: string): string => {
  return path.join(venvPath, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
};

/**
 * Get the version and build platform of python at the provided path, in a single process.
 *
 * The platform is `sysconfig.get_platform()` (e.g. `win-amd64`, `win-arm64`, `linux-x86_64`), which is fixed when the
 * interpreter is built. `platform.machine()` would not do: on Windows, CPython 3.12+ answers it from WMI, which reports
 * the physical CPU, so an emulated x86_64 interpreter on ARM64 claims to be `ARM64`.
 *
 * @param pythonPath
 * @returns The python version (e.g. `3.12.9`) and build platform.
 */
const getPythonVersionAndPlatform = async (pythonPath: string): Promise<{ version: string; platform: string }> => {
  const cmd = `"${pythonPath}" -c "import sys, sysconfig; print(sys.version.split()[0]); print(sysconfig.get_platform());"`;
  const { stdout } = await execAsync(cmd);
  const [version = '', platform = ''] = stdout.split(/\r?\n/).map((line) => line.trim());
  return { version, platform };
};

/**
 * Get the version of a Python package installed
 *
 * @param pythonPath Path to python executable to use (probably in a virtualenv)
 * @param packageName Name of the package to check
 * @returns The package version or null if not found
 */
const getPackageVersion = async (pythonPath: string, packageName: string): Promise<string | null> => {
  const result = await withResultAsync(async () => {
    const cmd = `"${pythonPath}" -c "from importlib.metadata import version; print(version('${packageName}'));"`;
    const { stdout } = await execAsync(cmd);
    return stdout;
  });

  if (result.isErr()) {
    console.debug(`Failed to get version for package ${packageName}:`, result.error);
    return null;
  }

  return result.value.replace(/[\r\n]+/g, '');
};

/**
 * Check if an existing installation is present at the given location.
 *
 * We assume the path is an existing install if:
 * - It is a directory
 * - It contains a `.venv` directory
 * - It contains a `invokeai.yaml` file
 *
 * @param installLocation The location to check for an existing installation
 * @returns Whether an existing installation is present at the given location
 */
export const getInstallationDetails = async (installLocation: string): Promise<DirDetails> => {
  // Must be a directory
  if (!(await isDirectory(installLocation))) {
    return {
      path: installLocation,
      isInstalled: false,
      isDirectory: false,
      canInstall: false,
    };
  }

  const venvPath = path.join(installLocation, '.venv');

  // Must contain a `.venv` directory
  if (!(await isDirectory(venvPath))) {
    return {
      path: installLocation,
      isInstalled: false,
      isDirectory: true,
      canInstall: true,
    };
  }

  const pythonPath = getPythonPathForVenv(venvPath);

  const version = await getPackageVersion(pythonPath, 'invokeai');

  if (!version) {
    return {
      path: installLocation,
      isDirectory: true,
      isInstalled: false,
      canInstall: true,
    };
  }

  const isFirstRun = !(await isFile(path.join(installLocation, 'invokeai.yaml')));
  const python = await getPythonVersionAndPlatform(pythonPath);

  return {
    path: installLocation,
    isInstalled: true,
    isDirectory: true,
    isFirstRun,
    canInstall: true,
    version: version.startsWith('v') ? version : `v${version}`, // Make it consistent w/ our tagging format
    pythonVersion: python.version,
    pythonPlatform: python.platform,
    pythonPath,
    invokeExecPath: getInvokeExecPath(installLocation),
    activateVenvPath: getActivateVenvPath(installLocation),
  };
};

//#endregion

//#region Process

/**
 * Kills a child process using the appropriate method for the platform
 * @param childProcess The child process to kill
 * @returns Promise that resolves when the process has been terminated
 */
export const killProcess = async (childProcess: ChildProcess): Promise<void> => {
  if (childProcess.pid === undefined) {
    // He's dead, Jim
    return;
  }

  const pid = childProcess.pid;

  // Helper to check if process is still running
  const isProcessRunning = (): boolean => {
    // First check if Node.js knows the process is dead
    if (childProcess.killed || childProcess.exitCode !== null) {
      return false;
    }

    try {
      // process.kill(pid, 0) checks if process exists without killing it
      // This can have false positives due to PID reuse, so we check childProcess.killed first
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  // Helper to wait for process exit with timeout
  const waitForExit = (timeoutMs: number): Promise<boolean> => {
    return new Promise((resolve) => {
      // If process has exit handler, use it for more reliable detection
      const exitHandler = () => {
        resolve(true);
      };

      // Try to attach exit handler if process is still alive
      if (!childProcess.killed) {
        childProcess.once('exit', exitHandler);
      }

      const startTime = Date.now();
      const checkInterval = setInterval(() => {
        if (!isProcessRunning()) {
          clearInterval(checkInterval);
          childProcess.removeListener('exit', exitHandler);
          resolve(true);
        } else if (Date.now() - startTime > timeoutMs) {
          clearInterval(checkInterval);
          childProcess.removeListener('exit', exitHandler);
          resolve(false);
        }
      }, 100);
    });
  };

  if (process.platform === 'win32') {
    // Windows: Try graceful shutdown first, then escalate if needed

    // Stage 1: Try graceful shutdown (sends WM_CLOSE)
    try {
      execFile('taskkill', ['/pid', pid.toString(), '/T'], (error) => {
        // Ignore error - process might resist graceful shutdown
        if (error) {
          console.debug(`Graceful shutdown failed for PID ${pid}: ${error.message}`);
        }
      });

      // Wait up to 5 seconds for graceful exit
      const exitedGracefully = await waitForExit(5000);
      if (exitedGracefully) {
        console.debug(`Process ${pid} terminated gracefully`);
        return;
      }
    } catch (error) {
      console.debug(`Failed to send graceful shutdown signal: ${error}`);
    }

    // Stage 2: Try Node's kill (might work for some processes)
    try {
      childProcess.kill('SIGTERM');

      // Wait 2 more seconds
      const exitedWithSigterm = await waitForExit(2000);
      if (exitedWithSigterm) {
        console.debug(`Process ${pid} terminated with SIGTERM`);
        return;
      }
    } catch (error) {
      console.debug(`SIGTERM failed: ${error}`);
    }

    // Stage 3: Force kill as last resort
    try {
      execFile('taskkill', ['/pid', pid.toString(), '/T', '/F'], (error) => {
        if (error) {
          console.error(`Force kill failed for PID ${pid}: ${error.message}`);
        }
      });

      // Wait for force kill to complete
      const exitedForcefully = await waitForExit(2000);
      if (!exitedForcefully) {
        console.error(`Process ${pid} could not be terminated even with force kill`);
      } else {
        console.debug(`Process ${pid} force terminated`);
      }
    } catch (error) {
      console.error(`Critical error killing process ${pid}: ${error}`);
    }
  } else {
    // Unix-like systems: Use SIGTERM
    childProcess.kill('SIGTERM');

    // Wait for process to exit
    const exited = await waitForExit(5000);
    if (!exited) {
      // Try SIGKILL as last resort
      try {
        childProcess.kill('SIGKILL');
        await waitForExit(2000);
      } catch (error) {
        console.error(`Failed to kill process ${pid}: ${error}`);
      }
    }
  }
};

/**
 * Gets the shell to use for running commands. If the COMSPEC (Windows) or SHELL (Linux/macOS) environment variables
 * are set, they will be used. Otherwise, Windows will default to Powershell and Linux/macOS will default to sh.
 * @returns The shell to use for running commands
 */
export const getShell = () => {
  if (process.platform === 'win32') {
    return 'Powershell.exe';
  } else if (process.platform === 'darwin') {
    return '/bin/zsh';
  } else {
    // Linux
    return '/bin/bash';
  }
};

//#endregion

//#region Environment

/**
 * Check if the current environment is development
 * @returns Whether the current environment is development
 */
export const isDevelopment = (): boolean => process.env.NODE_ENV === 'development';

//#endregion

//#region Window mgmt

/**
 * Checks if the given rect exceeds the screen bounds
 */
const exceedsScreenBounds = (bounds: Electron.Rectangle): boolean => {
  const screenArea = screen.getDisplayMatching(bounds).workArea;
  return (
    bounds.x > screenArea.x + screenArea.width ||
    bounds.x < screenArea.x ||
    bounds.y < screenArea.y ||
    bounds.y > screenArea.y + screenArea.height
  );
};

/**
 * Manages a window's size:
 * - Restores the window to its previous size and position, maximizing or fullscreening it if necessary
 * - Saves the window's size and position when it is closed
 * - If provided, uses the initialProps to set the window's size and position
 *
 * The window will not be set to the stored/initial bounds if it exceeds the current screen bounds.
 *
 * @param window The window to manage
 * @param windowProps The stored window properties
 * @param setWindowProps The function to call to save the window properties
 * @param initialProps The initial window properties to use if there are no stored properties
 */
export const manageWindowSize = (
  window: BrowserWindow,
  windowProps: WindowProps | undefined,
  setWindowProps: (windowProps: WindowProps) => void,
  initialProps?: Partial<WindowProps>
): void => {
  if (windowProps) {
    // Restore window size and position
    const { bounds, isMaximized, isFullScreen } = windowProps;
    if (!exceedsScreenBounds(bounds)) {
      window.setBounds(bounds);
    }
    if (isMaximized) {
      window.maximize();
    }
    if (isFullScreen) {
      window.setFullScreen(true);
    }
  } else if (initialProps) {
    // No stored properties, use initial properties if they exist
    const { bounds, isMaximized, isFullScreen } = initialProps;
    if (bounds && !exceedsScreenBounds(bounds)) {
      window.setBounds(bounds);
    }
    if (isMaximized) {
      window.maximize();
    }
    if (isFullScreen) {
      window.setFullScreen(true);
    }
  }

  // Save window size and position on close. We intentionally do not remove this listener: a close may be prevented
  // (e.g. by a confirmation dialog), and we still want to persist the latest bounds when the window is eventually closed.
  const handleClose = () => {
    setWindowProps({
      bounds: window.getBounds(),
      isMaximized: window.isMaximized(),
      isFullScreen: window.isFullScreen(),
    });
  };

  window.on('close', handleClose);
};
