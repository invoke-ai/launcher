import childProcess from 'child_process';
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

/**
 * Kill a PTY process and wait for it to exit with timeout support
 * @param ptyProcess The PTY process to kill
 * @param timeout Maximum time to wait in milliseconds (default: 5000)
 * @returns Promise that resolves when process exits or timeout occurs
 */
export function killPtyProcessAsync(ptyProcess: pty.IPty, timeout: number = 5000): Promise<void> {
  return new Promise<void>((resolve) => {
    let timeoutId: NodeJS.Timeout | null = null;
    let resolved = false;

    const cleanup = () => {
      if (resolved) {
        return;
      }
      resolved = true;

      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      resolve();
    };

    ptyProcess.onExit(() => cleanup());

    timeoutId = setTimeout(() => {
      console.warn(`PTY process did not exit within ${timeout}ms, continuing anyway`);
      cleanup();
    }, timeout);

    try {
      if (process.platform === 'win32') {
        childProcess.exec(`taskkill /PID ${ptyProcess.pid} /F /T`);
      } else {
        ptyProcess.kill('SIGTERM');
      }
    } catch (error) {
      console.warn('Error killing PTY process:', error);
      cleanup();
    }
  });
}
