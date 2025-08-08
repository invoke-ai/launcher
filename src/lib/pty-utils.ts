import * as pty from 'node-pty';

import { AnsiSequenceBuffer } from '@/lib/ansi-sequence-buffer';

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
 * PTY entry containing process and buffer
 */
export interface PtyEntry {
  id: string;
  process: pty.IPty;
  ansiSequenceBuffer: AnsiSequenceBuffer;
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
  ansiBuffer?: AnsiSequenceBuffer
): void {
  ptyProcess.onData((data) => {
    if (ansiBuffer) {
      ansiBuffer.append(data);
    }
    callbacks.onData(data);
  });

  ptyProcess.onExit(({ exitCode, signal }) => {
    if (ansiBuffer) {
      ansiBuffer.clear();
    }
    callbacks.onExit(exitCode, signal);
  });
}

/**
 * Create buffer for PTY output management
 */
export function createPtyBuffer() {
  return new AnsiSequenceBuffer();
}
