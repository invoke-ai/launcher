import type { ChildProcess } from 'child_process';
import { exec, execFile } from 'child_process';
import type { BrowserWindow } from 'electron';
import { app, screen } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';

import { withResultAsync } from '@/lib/result';
import type { DirDetails, GpuType, OperatingSystem, WindowProps } from '@/shared/types';

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
 * Gets the appropriate platform for a given GPU type.
 *
 * Note: If the system is MacOS, we return 'cpu' regardless of the given GPU type.
 *
 * @param gpuType The GPU type
 * @returns The platform corresponding to the GPU type
 */
export const getTorchPlatform = (gpuType: GpuType): 'cuda' | 'rocm' | 'cpu' => {
  if (process.platform === 'darwin') {
    // macOS uses MPS, but we don't need to provide a separate option for this because pytorch doesn't have a separate index url for MPS
    return 'cpu';
  } else {
    switch (gpuType) {
      case 'amd':
        return 'rocm';
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
 * Get the version of python at the provided path.
 *
 * @param pythonPath
 * @returns The python version as a string.
 */
const getPythonVersion = async (pythonPath: string): Promise<string> => {
  const cmd = `"${pythonPath}" -c "import sys; print(sys.version.split()[0]);"`;
  const { stdout } = await execAsync(cmd);
  return stdout.replace(/[\r\n]+/g, '');
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

  return {
    path: installLocation,
    isInstalled: true,
    isDirectory: true,
    isFirstRun,
    canInstall: true,
    version: version.startsWith('v') ? version : `v${version}`, // Make it consistent w/ our tagging format
    pythonVersion: await getPythonVersion(pythonPath),
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
 */
export const killProcess = (childProcess: ChildProcess): void => {
  if (childProcess.pid === undefined) {
    // He's dead, Jim
    return;
  }

  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', childProcess.pid.toString(), '/T', '/F']);
  } else {
    childProcess.kill('SIGTERM');
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

  // Save window size and position when it is closed and clear the event listener
  const handleClose = () => {
    setWindowProps({
      bounds: window.getBounds(),
      isMaximized: window.isMaximized(),
      isFullScreen: window.isFullScreen(),
    });
    window.off('close', handleClose);
  };

  window.on('close', handleClose);
};
