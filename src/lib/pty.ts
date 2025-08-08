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

export const DEFAULT_ENV: Record<string, string> = {
  FORCE_COLOR: '1',
  PYTHONUNBUFFERED: '1',
};

type PtyEntry = {
  id: string;
  process: pty.IPty;
  ansiSequenceBuffer: AnsiSequenceBuffer;
  historyBuffer: SlidingBuffer<string>;
};

type CreateShellArgs = {
  id?: string;
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
  onData: (id: string, data: string) => void;
  onExit: (id: string, exitCode: number, signal?: number) => void;
};

type CreateCommandArgs = {
  id?: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
  onData: (id: string, data: string) => void;
  onExit: (id: string, exitCode: number, signal?: number) => void;
};

// Legacy type for backward compatibility
type CreatePtyArgs = {
  onData: (id: string, data: string) => void;
  onExit: (id: string, exitCode: number, signal?: number) => void;
  options?: PtyOptions;
};

const PtyNotFound = Symbol('PtyNotFound');

export class PtyManager {
  ptys: Map<string, PtyEntry> = new Map();
  options: PtyManagerOptions;
  subscriptions: Set<() => void> = new Set();

  constructor(options?: Partial<PtyManagerOptions>) {
    this.options = { ...DEFAULT_PTY_MANAGER_OPTIONS, ...options };
  }

  /**
   * Create an interactive shell PTY (for Console)
   */
  createShell = ({ id, cwd, env, cols, rows, onData, onExit }: CreateShellArgs): PtyEntry => {
    const ptyId = id ?? nanoid();
    const shell = getShell();

    const ptyProcess = pty.spawn(shell, [], {
      name: process.env['TERM'] ?? 'xterm-color',
      cwd: cwd ?? process.env.HOME,
      env: { ...process.env, ...DEFAULT_ENV, ...env },
      cols,
      rows,
    });

    return this.setupPtyEntry(ptyId, ptyProcess, onData, onExit);
  };

  /**
   * Create a command execution PTY (for Install/Invoke managers)
   */
  createCommand = ({ id, command, args, cwd, env, cols, rows, onData, onExit }: CreateCommandArgs): PtyEntry => {
    const ptyId = id ?? nanoid();

    const ptyProcess = pty.spawn(command, args, {
      name: process.env['TERM'] ?? 'xterm-color',
      cwd: cwd ?? process.cwd(),
      env: { ...process.env, ...DEFAULT_ENV, ...env },
      cols,
      rows,
    });

    return this.setupPtyEntry(ptyId, ptyProcess, onData, onExit);
  };

  /**
   * Legacy create method for backward compatibility
   */
  create = ({ onData, onExit, options }: CreatePtyArgs): PtyEntry => {
    return this.createShell({
      cwd: options?.cwd,
      onData,
      onExit,
    });
  };

  /**
   * Common setup for PTY entries
   */
  private setupPtyEntry = (
    id: string,
    ptyProcess: pty.IPty,
    onData: (id: string, data: string) => void,
    onExit: (id: string, exitCode: number, signal?: number) => void
  ): PtyEntry => {
    const ansiSequenceBuffer = new AnsiSequenceBuffer();
    const historyBuffer = new SlidingBuffer<string>(this.options.maxHistorySize);

    ptyProcess.onData((data) => {
      const result = ansiSequenceBuffer.append(data);
      if (!result.hasIncomplete) {
        historyBuffer.push(result.complete);
      }
      onData(id, data);
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      ansiSequenceBuffer.clear();
      historyBuffer.clear();
      this.ptys.delete(id);
      onExit(id, exitCode, signal);
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

  /**
   * Kill a PTY process with an optional signal
   */
  kill = (id: string, signal?: string): void => {
    this.do(id, (entry) => {
      entry.process.kill(signal);
    });
  };

  dispose = (id: string): void => {
    this.do(id, (entry) => {
      entry.process.kill();
      entry.ansiSequenceBuffer.clear();
      entry.historyBuffer.clear();
      this.ptys.delete(id);
    });
  };

  teardown = () => {
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
}
