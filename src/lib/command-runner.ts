import { nanoid } from 'nanoid';

import type { PtyCallbacks, PtyEntry, PtyProcessOptions } from '@/lib/pty-utils';
import { createPtyBuffer, createPtyProcess, killPtyProcessAsync, setupPtyCallbacks } from '@/lib/pty-utils';

/**
 * Options for running a command
 */
interface CommandOptions {
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
}

/**
 * Callbacks for command execution events
 */
interface CommandCallbacks {
  onData?: (data: string) => void;
  onExit?: (exitCode: number, signal?: number) => void;
}

/**
 * CommandRunner manages execution of individual commands with PTY support.
 * Each command runs in its own PTY process with proper terminal emulation.
 */
export class CommandRunner {
  private currentEntry: PtyEntry | null = null;

  constructor() {}

  /**
   * Run a command with PTY support
   * Returns a promise that resolves when the command completes
   */
  async runCommand(
    command: string,
    args: string[],
    options?: CommandOptions,
    callbacks?: CommandCallbacks
  ): Promise<{ exitCode: number; signal?: number }> {
    // Kill any existing command first
    if (this.currentEntry) {
      await this.kill();
    }

    return new Promise((resolve, reject) => {
      try {
        const id = nanoid();
        const ansiBuffer = createPtyBuffer();

        const ptyOptions: PtyProcessOptions = {
          command,
          args,
          cwd: options?.cwd,
          env: options?.env,
          cols: options?.cols,
          rows: options?.rows,
        };

        const process = createPtyProcess(ptyOptions);

        const ptyCallbacks: PtyCallbacks = {
          onData: (data) => {
            callbacks?.onData?.(data);
          },
          onExit: (exitCode, signal) => {
            // Clear current entry
            this.currentEntry = null;

            // Call user callback
            callbacks?.onExit?.(exitCode, signal);

            // Resolve the promise
            resolve({ exitCode, signal });
          },
        };

        setupPtyCallbacks(process, ptyCallbacks, ansiBuffer);

        this.currentEntry = {
          id,
          process,
          ansiSequenceBuffer: ansiBuffer,
        };
      } catch (error) {
        this.currentEntry = null;
        reject(error);
      }
    });
  }

  /**
   * Kill the current running command and wait for it to exit
   */
  async kill(timeout?: number): Promise<void> {
    if (this.currentEntry) {
      const entry = this.currentEntry;
      this.currentEntry = null;
      entry.ansiSequenceBuffer.clear();
      await killPtyProcessAsync(entry.process, timeout);
    }
  }

  /**
   * Resize the current PTY
   */
  resize(cols: number, rows: number): void {
    if (this.currentEntry) {
      this.currentEntry.process.resize(cols, rows);
    }
  }

  /**
   * Write data to the current PTY
   */
  write(data: string): void {
    if (this.currentEntry) {
      this.currentEntry.process.write(data);
    }
  }

  /**
   * Check if a command is currently running
   */
  isRunning(): boolean {
    return this.currentEntry !== null;
  }

  /**
   * Get the PID of the current process
   */
  getPid(): number | undefined {
    return this.currentEntry?.process.pid;
  }

  /**
   * Dispose of the command runner and wait for process to exit
   */
  async dispose(): Promise<void> {
    await this.kill();
  }
}
