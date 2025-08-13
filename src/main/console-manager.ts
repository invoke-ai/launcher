import type { IpcListener } from '@electron-toolkit/typed-ipc/main';
import { ipcMain } from 'electron';
import { nanoid } from 'nanoid';

import type { PtyCallbacks, PtyEntry } from '@/lib/pty-utils';
import { createPtyBuffer, createPtyProcess, killPtyProcessAsync, setupPtyCallbacks } from '@/lib/pty-utils';
import {
  getActivateVenvCommand,
  getBundledBinPath,
  getHomeDirectory,
  getInstallationDetails,
  getShell,
} from '@/main/util';
import type { IpcEvents, IpcRendererEvents } from '@/shared/types';

/**
 * ConsoleManager manages a singleton interactive shell PTY for the terminal/console.
 * Unlike command execution, this provides an interactive shell session.
 */
export class ConsoleManager {
  private consoleEntry: PtyEntry | null = null;

  constructor() {}

  /**
   * Create the singleton console PTY
   * Returns the console ID
   */
  async createConsole(
    callbacks: {
      onData: (id: string, data: string) => void;
      onExit: (id: string, exitCode: number, signal?: number) => void;
    },
    initialCwd?: string
  ): Promise<string> {
    // If a console already exists, dispose it first
    if (this.consoleEntry) {
      this.dispose();
    }

    const id = nanoid();
    const shell = getShell();
    const ansiBuffer = createPtyBuffer();

    const process = createPtyProcess({
      command: shell,
      args: [],
      cwd: getHomeDirectory(),
    });

    const ptyCallbacks: PtyCallbacks = {
      onData: (data) => {
        callbacks.onData(id, data);
      },
      onExit: (exitCode, signal) => {
        // Clean up on exit
        if (this.consoleEntry?.id === id) {
          this.consoleEntry = null;
        }
        callbacks.onData(id, `Process exited with code ${exitCode}${signal ? `, signal: ${signal}` : ''}`);
        callbacks.onExit(id, exitCode, signal);
      },
    };

    setupPtyCallbacks(process, ptyCallbacks, ansiBuffer);

    this.consoleEntry = {
      id,
      process,
      ansiSequenceBuffer: ansiBuffer,
    };

    // Initialize the console environment
    await this.initializeConsole(initialCwd);

    return id;
  }

  /**
   * Initialize the console with PATH and optional venv activation
   */
  private async initializeConsole(cwd?: string): Promise<void> {
    if (!this.consoleEntry) {
      return;
    }

    // Add the bundled bin dir to the PATH env var
    if (process.platform === 'win32') {
      this.consoleEntry.process.write(`$env:Path='${getBundledBinPath()};'+$env:Path\r`);
    } else {
      // macOS, Linux
      this.consoleEntry.process.write(`export PATH="${getBundledBinPath()}:$PATH"\r`);
    }

    if (cwd) {
      const installDetails = await getInstallationDetails(cwd);
      // If the cwd is a valid installation dir, we should activate the venv
      if (installDetails.isInstalled) {
        const activateVenvCmd = getActivateVenvCommand(installDetails.path);
        this.consoleEntry.process.write(`${activateVenvCmd}\r`);
      }
      // If the cwd is a directory, we should cd into it, even if it is not a valid installation dir - the user may
      // want to run commands there to fix something.
      if (installDetails.isDirectory) {
        this.consoleEntry.process.write(`cd ${cwd}\r`);
      }
    }
  }

  /**
   * Write data to the console
   */
  write(data: string): void {
    if (this.consoleEntry) {
      this.consoleEntry.process.write(data);
    }
  }

  /**
   * Resize the console PTY
   */
  resize(cols: number, rows: number): void {
    if (this.consoleEntry) {
      this.consoleEntry.process.resize(cols, rows);
    }
  }

  /**
   * Dispose of the console PTY
   */
  async dispose(): Promise<void> {
    if (this.consoleEntry) {
      const entry = this.consoleEntry;
      this.consoleEntry = null;
      await killPtyProcessAsync(entry.process);
      entry.ansiSequenceBuffer.clear();
    }
  }

  /**
   * Get the current console ID
   */
  getConsoleId(): string | null {
    return this.consoleEntry?.id ?? null;
  }

  /**
   * Check if a console is currently active
   */
  isActive(): boolean {
    return this.consoleEntry !== null;
  }
}

/**
 * Create a ConsoleManager instance and set up IPC handlers
 * Returns the manager instance and a cleanup function
 */
export const createConsoleManager = (arg: {
  ipc: IpcListener<IpcEvents>;
  sendToWindow: <T extends keyof IpcRendererEvents>(channel: T, ...args: IpcRendererEvents[T]) => void;
}): [ConsoleManager, () => void] => {
  const { ipc, sendToWindow } = arg;

  const consoleManager = new ConsoleManager();

  const onData = (id: string, data: string) => {
    sendToWindow('terminal:output', id, data);
  };

  const onExit = (id: string, exitCode: number) => {
    sendToWindow('terminal:exited', id, exitCode);
  };

  // IPC handlers - maintaining compatibility with existing terminal interface
  ipc.handle('terminal:create', (_, cwd) => {
    return consoleManager.createConsole({ onData, onExit }, cwd);
  });

  ipc.handle('terminal:dispose', async (_) => {
    await consoleManager.dispose();
  });

  ipc.handle('terminal:resize', (_, id, cols, rows) => {
    consoleManager.resize(cols, rows);
  });

  ipc.handle('terminal:write', (_, id, data) => {
    consoleManager.write(data);
  });

  ipc.handle('terminal:list', (_) => {
    const id = consoleManager.getConsoleId();
    return id ? [id] : [];
  });

  const cleanup = async () => {
    await consoleManager.dispose();
    ipcMain.removeHandler('terminal:create');
    ipcMain.removeHandler('terminal:dispose');
    ipcMain.removeHandler('terminal:resize');
    ipcMain.removeHandler('terminal:write');
    ipcMain.removeHandler('terminal:list');
  };

  return [consoleManager, cleanup];
};
