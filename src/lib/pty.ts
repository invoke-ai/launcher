import { nanoid } from 'nanoid';
import * as pty from 'node-pty';

import { AnsiSequenceBuffer } from '@/lib/ansi-sequence-buffer';
import { SlidingBuffer } from '@/lib/sliding-buffer';
import { getShell } from '@/main/util';
import type { PtyOptions } from '@/shared/types';

type PtyManagerOptions = {
  maxHistorySize: number;
};

const DEFAULT_PTY_MANAGER_OPTIONS: PtyManagerOptions = {
  maxHistorySize: 1000,
};

type PtyEntry = {
  id: string;
  process: pty.IPty;
  ansiSequenceBuffer: AnsiSequenceBuffer;
  historyBuffer: SlidingBuffer<string>;
};

type CreatePtyArgs = {
  onData: (id: string, data: string) => void;
  onExit: (id: string, exitCode: number) => void;
  options?: PtyOptions;
};

type CommandExecution = {
  id: string; // PTY ID
  marker: string;
  resolve: (value: { exitCode: number; output: string }) => void;
  reject: (reason: Error) => void;
  output: string[];
};

export const PtyNotFound = Symbol('PtyNotFound');

export class PtyManager {
  ptys: Map<string, PtyEntry> = new Map();
  options: PtyManagerOptions;
  subscriptions: Set<() => void> = new Set();
  // Add this new property to track active commands
  private activeCommands = new Map<string, CommandExecution>();

  constructor(options?: Partial<PtyManagerOptions>) {
    this.options = { ...DEFAULT_PTY_MANAGER_OPTIONS, ...options };
  }

  create = ({ onData, onExit, options }: CreatePtyArgs): PtyEntry => {
    const id = nanoid();
    const shell = getShell();

    const ptyProcess = pty.spawn(shell, [], {
      name: process.env['TERM'] ?? 'xterm-color',
      cwd: options?.cwd ?? process.env.HOME,
      env: process.env,
    });

    const ansiSequenceBuffer = new AnsiSequenceBuffer();
    const historyBuffer = new SlidingBuffer<string>(this.options.maxHistorySize);

    ptyProcess.onData((data) => {
      // Check if this data contains a command completion marker
      this.checkForCommandCompletion(id, data);

      const result = ansiSequenceBuffer.append(data);
      if (!result.hasIncomplete) {
        historyBuffer.push(result.complete);
      }
      onData(id, data);
    });

    ptyProcess.onExit(({ exitCode }) => {
      // Reject any pending commands for this PTY
      for (const [marker, command] of this.activeCommands.entries()) {
        if (command.id === id) {
          command.reject(new Error(`Process exited with code ${exitCode} before command completed`));
          this.activeCommands.delete(marker);
        }
      }

      ansiSequenceBuffer.clear();
      historyBuffer.clear();
      this.ptys.delete(id);
      onData(id, `\nProcess exited with code ${exitCode}.\r\n`);
      onExit(id, exitCode);
    });

    const entry = { id, process: ptyProcess, ansiSequenceBuffer, historyBuffer };

    this.ptys.set(id, entry);

    return entry;
  };

  write = (id: string, data: string): void => {
    this.do(id, (entry) => {
      entry.process.write(data);
    });
  };

  resize = (id: string, cols: number, rows: number): void => {
    this.do(id, (entry) => {
      entry.process.resize(cols, rows);
    });
  };

  replay = (id: string): string | null => {
    const entry = this.ptys.get(id);
    if (!entry) {
      return null;
    }
    return entry.historyBuffer.get().join('');
  };

  dispose = (id: string): void => {
    // Reject any pending commands for this PTY
    for (const [marker, command] of this.activeCommands.entries()) {
      if (command.id === id) {
        command.reject(new Error('PTY was disposed'));
        this.activeCommands.delete(marker);
      }
    }

    this.do(id, (entry) => {
      entry.process.kill();
      entry.ansiSequenceBuffer.clear();
      entry.historyBuffer.clear();
      this.ptys.delete(id);
    });
  };

  teardown = () => {
    // Reject all pending commands
    for (const [marker, command] of this.activeCommands.entries()) {
      command.reject(new Error('PTY manager was torn down'));
      this.activeCommands.delete(marker);
    }

    const ids = this.ptys.keys();
    for (const id of ids) {
      this.dispose(id);
    }
  };

  list = (): string[] => {
    return Array.from(this.ptys.keys());
  };

  /**
   * Do something with a PtyEntry. If the entry does not exist, return the PtyNotFound symbol.
   */
  private do = <R, T extends (entry: PtyEntry) => R>(id: string, callback: T): R | typeof PtyNotFound => {
    const entry = this.ptys.get(id);
    if (!entry) {
      return PtyNotFound;
    }
    return callback(entry);
  };

  /**
   * Run a command in a PTY and wait for it to complete.
   * @returns Promise that resolves with the exit code and output when the command completes
   */
  runCommand = (
    id: string,
    command: string,
    options?: { timeout?: number }
  ): Promise<{ exitCode: number; output: string }> | typeof PtyNotFound => {
    return this.do(id, (entry) => {
      // Generate a unique marker for this command
      const marker = `__CMD_MARKER_${nanoid(8)}__`;

      // Create a promise that will resolve when the command completes
      const commandPromise = new Promise<{ exitCode: number; output: string }>((resolve, reject) => {
        // Store command tracking info
        this.activeCommands.set(marker, {
          id: id,
          marker,
          resolve,
          reject,
          output: [],
        });

        // Create the shell command that includes our marker
        const wrappedCommand = this.wrapCommandForShell(command, marker);

        // Send the command to the PTY
        entry.process.write(`${wrappedCommand}\r`);
      });

      if (!options?.timeout) {
        return commandPromise;
      }

      // Add timeout handling if specified
      const timeoutPromise = new Promise<{ exitCode: number; output: string }>((_, reject) => {
        setTimeout(() => {
          if (this.activeCommands.has(marker)) {
            this.activeCommands.delete(marker);
            reject(new Error(`Command timed out after ${options.timeout}ms`));
          }
        }, options.timeout);
      });

      return Promise.race([commandPromise, timeoutPromise]);
    });
  };

  /**
   * Wrap a command so that it outputs a marker and exit code when done.
   * Different shells need different syntax.
   */
  private wrapCommandForShell(command: string, marker: string): string {
    const shell = getShell().toLowerCase();
    const isWindows = process.platform === 'win32';

    if (isWindows && (shell.includes('powershell') || shell.includes('pwsh'))) {
      // PowerShell syntax
      return `& { ${command}; Write-Host "${marker}:$LASTEXITCODE" }`;
    } else if (isWindows && shell.includes('cmd')) {
      // Windows CMD syntax
      return `${command} & echo ${marker}:%ERRORLEVEL%`;
    } else {
      // Bash/sh/zsh syntax (default for macOS/Linux)
      return `{ ${command}; } && echo "${marker}:$?"; true`;
    }
  }

  /**
   * Check if the data from a PTY contains a command completion marker.
   */
  private checkForCommandCompletion(ptyId: string, data: string): void {
    // Check each active command
    for (const [marker, command] of this.activeCommands.entries()) {
      if (command.id !== ptyId) {
        continue;
      }

      // Collect the output
      command.output.push(data);

      // Look for the marker pattern: MARKER:EXIT_CODE
      const pattern = new RegExp(`${marker}:(\\d+)`);
      const match = data.match(pattern);

      if (match?.[1]) {
        const exitCode = parseInt(match[1], 10);
        const output = command.output.join('');

        this.activeCommands.delete(marker);
        command.resolve({ exitCode, output });
      }
    }
  }
}
