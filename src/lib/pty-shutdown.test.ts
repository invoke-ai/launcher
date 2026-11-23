import type { IPty } from 'node-pty';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { killPtyProcessAsync, waitForPendingPtyExits } from './pty-utils';

// Tests drive the exit notification directly. Never signal a real PID.
vi.mock('child_process', () => ({ default: { exec: vi.fn() } }));
vi.mock('node-pty', () => ({}));

function startStopping() {
  let notifyExit!: () => void;
  const pty = {
    kill: vi.fn(),
    onExit: (callback: () => void) => {
      notifyExit = callback;
    },
  } as unknown as IPty;
  const stopped = killPtyProcessAsync(pty, 100);
  return { stopped, notifyExit };
}

afterEach(() => vi.useRealTimers());

describe('PTYs already stopping at quit time', () => {
  it('waits for all outstanding exits, including a stop started by the user', async () => {
    const first = startStopping();
    const second = startStopping();
    const done = vi.fn();
    const shutdown = waitForPendingPtyExits().then(done);
    first.notifyExit();
    await first.stopped;
    expect(done).not.toHaveBeenCalled();
    second.notifyExit();
    await shutdown;
    expect(done).toHaveBeenCalledOnce();
  });

  it('honors the existing stop timeout if a PTY never reports its exit', async () => {
    vi.useFakeTimers();
    startStopping();
    const done = vi.fn();
    const shutdown = waitForPendingPtyExits().then(done);
    await vi.advanceTimersByTimeAsync(99);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await shutdown;
    expect(done).toHaveBeenCalledOnce();
  });
});
