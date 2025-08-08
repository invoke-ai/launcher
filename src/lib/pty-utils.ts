import * as pty from 'node-pty';

import { AnsiSequenceBuffer } from '@/lib/ansi-sequence-buffer';
import { SlidingBuffer } from '@/lib/sliding-buffer';

/**
 * Default environment variables for PTY processes
 */
export const DEFAULT_ENV: Record<string, string> = {
  FORCE_COLOR: '1',
  PYTHONUNBUFFERED: '1',
};

/**
 * Options for creating a PTY process
 */
export interface PtyProcessOptions {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
}

/**
 * Callbacks for PTY process events
 */
export interface PtyCallbacks {
  onData: (data: string) => void;
  onExit: (exitCode: number, signal?: number) => void;
}

/**
 * Buffer configuration for PTY output
 */
export interface PtyBufferConfig {
  maxHistorySize?: number;
}

/**
 * PTY entry containing process and buffers
 */
export interface PtyEntry {
  id: string;
  process: pty.IPty;
  ansiSequenceBuffer: AnsiSequenceBuffer;
  historyBuffer: SlidingBuffer<string>;
}

/**
 * Create a PTY process with the given options
 */
export function createPtyProcess(options: PtyProcessOptions): pty.IPty {
  return pty.spawn(options.command, options.args, {
    name: process.env['TERM'] ?? 'xterm-color',
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, ...DEFAULT_ENV, ...options.env },
    cols: options.cols,
    rows: options.rows,
  });
}

/**
 * Set up callbacks for a PTY process with optional buffer management
 */
export function setupPtyCallbacks(
  ptyProcess: pty.IPty,
  callbacks: PtyCallbacks,
  buffers?: {
    ansiBuffer: AnsiSequenceBuffer;
    historyBuffer: SlidingBuffer<string>;
  }
): void {
  ptyProcess.onData((data) => {
    if (buffers) {
      const result = buffers.ansiBuffer.append(data);
      if (!result.hasIncomplete) {
        buffers.historyBuffer.push(result.complete);
      }
    }
    callbacks.onData(data);
  });

  ptyProcess.onExit(({ exitCode, signal }) => {
    if (buffers) {
      buffers.ansiBuffer.clear();
      buffers.historyBuffer.clear();
    }
    callbacks.onExit(exitCode, signal);
  });
}

/**
 * Create buffers for PTY output management
 */
export function createPtyBuffers(config: PtyBufferConfig = {}) {
  const maxHistorySize = config.maxHistorySize ?? 1000;
  return {
    ansiBuffer: new AnsiSequenceBuffer(),
    historyBuffer: new SlidingBuffer<string>(maxHistorySize),
  };
}
