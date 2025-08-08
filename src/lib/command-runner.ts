import { nanoid } from 'nanoid';

import type { PtyCallbacks, PtyEntry, PtyProcessOptions } from '@/lib/pty-utils';
import { createPtyBuffer, createPtyProcess, setupPtyCallbacks } from '@/lib/pty-utils';

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
  runCommand(
    command: string,
    args: string[],
    options?: CommandOptions,
    callbacks?: CommandCallbacks
  ): Promise<{ exitCode: number; signal?: number }> {
    // Kill any existing command first
    if (this.currentEntry) {
      this.kill();
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
   * Kill the current running command
   */
  kill(signal?: string): void {
    if (this.currentEntry) {
      this.currentEntry.process.kill(signal);
      this.currentEntry.ansiSequenceBuffer.clear();
      this.currentEntry = null;
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
   * Dispose of the command runner and kill any running process
   */
  dispose(): void {
    this.kill();
  }
}
