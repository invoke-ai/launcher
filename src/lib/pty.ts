import { nanoid } from 'nanoid';
import * as pty from 'node-pty';
import path from 'path';

import { AnsiSequenceBuffer } from '@/lib/ansi-sequence-buffer';
import { SlidingBuffer } from '@/lib/sliding-buffer';
import { getBundledBinPath, getShell } from '@/main/util';
import type { PtyOptions } from '@/shared/types';

type PtyManagerOptions = {
  maxHistorySize: number;
};

const DEFAULT_PTY_MANAGER_OPTIONS: PtyManagerOptions = {
  maxHistorySize: 1000,
};

type PtyEntry = {
  process: pty.IPty;
  ansiSequenceBuffer: AnsiSequenceBuffer;
  historyBuffer: SlidingBuffer<string>;
};

type CreatePtyArgs = {
  onData: (id: string, data: string) => void;
  onExit: (id: string, exitCode: number) => void;
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

  create = ({ onData, onExit, options }: CreatePtyArgs): string => {
    const id = nanoid();
    const shell = getShell();

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${getBundledBinPath()}${path.delimiter}${process.env.PATH}`,
    };

    const ptyProcess = pty.spawn(shell, [], {
      name: process.env['TERM'] ?? 'xterm-color',
      cwd: options?.cwd ?? process.env.HOME,
      env,
    });

    if (shell === 'Powershell.exe') {
      ptyProcess.write(`$env:PATH="${env.PATH}"\r`);
    }

    const ansiSequenceBuffer = new AnsiSequenceBuffer();
    const historyBuffer = new SlidingBuffer<string>(this.options.maxHistorySize);

    if (options?.cmd) {
      for (const cmd of options.cmd) {
        ptyProcess.write(cmd);
        ptyProcess.write('\r');
      }
    }

    ptyProcess.onData((data) => {
      const result = ansiSequenceBuffer.append(data);
      if (!result.hasIncomplete) {
        historyBuffer.push(result.complete);
      }
      onData(id, data);
    });

    ptyProcess.onExit(({ exitCode }) => {
      ansiSequenceBuffer.clear();
      historyBuffer.clear();
      this.ptys.delete(id);
      onData(id, `\nProcess exited with code ${exitCode}.\r\n`);
      onExit(id, exitCode);
    });

    this.ptys.set(id, { process: ptyProcess, ansiSequenceBuffer, historyBuffer });
    return id;
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
