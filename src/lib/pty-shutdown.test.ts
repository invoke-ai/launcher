import type { IPty } from 'node-pty';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { finishPendingPtyStops, killPtyProcessAsync } from './pty-utils';

// Tests drive the exit notification directly. Never signal a real PID.
const { readParent } = vi.hoisted(() => ({
  readParent: vi.fn(() => ({ status: 0, stdout: String(process.pid) })),
}));
vi.mock('child_process', () => ({ default: { exec: vi.fn(), spawnSync: readParent } }));
vi.mock('node-pty', () => ({}));

function startStopping() {
  let notifyExit!: () => void;
  const pty = {
    pid: 123,
    kill: vi.fn(),
    onExit: (callback: () => void) => {
      notifyExit = callback;
    },
  } as unknown as IPty;
  const stopped = killPtyProcessAsync(pty, 100);
  return { stopped, notifyExit, kill: pty.kill };
}

afterEach(() => vi.useRealTimers());

describe('PTYs already stopping at quit time', () => {
  it('waits for all outstanding exits, including a stop started by the user', async () => {
    const first = startStopping();
    const second = startStopping();
    const done = vi.fn();
    const shutdown = finishPendingPtyStops().then(done);
    first.notifyExit();
    await first.stopped;
    expect(done).not.toHaveBeenCalled();
    second.notifyExit();
    await shutdown;
    expect(done).toHaveBeenCalledOnce();
  });

  it('honors the existing stop timeout if a PTY never reports its exit', async () => {
    vi.useFakeTimers();
    const stuck = startStopping();
    const done = vi.fn();
    const shutdown = finishPendingPtyStops().then(done);
    await vi.advanceTimersByTimeAsync(99);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await shutdown;
    expect(done).toHaveBeenCalledOnce();
    if (process.platform !== 'win32') {
      expect(stuck.kill).toHaveBeenLastCalledWith('SIGKILL');
    }
    stuck.notifyExit();
  });

  it.skipIf(process.platform === 'win32')('skips a stale PID that no longer belongs to the launcher', async () => {
    vi.useFakeTimers();
    const stale = startStopping();
    await vi.advanceTimersByTimeAsync(100);
    readParent.mockReturnValueOnce({ status: 0, stdout: '1' });
    await finishPendingPtyStops();
    expect(stale.kill).not.toHaveBeenCalledWith('SIGKILL');
    stale.notifyExit();
  });

  it('leaves an ordinary stop at its normal timeout until the app actually quits', async () => {
    vi.useFakeTimers();
    const stuck = startStopping();
    await vi.advanceTimersByTimeAsync(100);
    await stuck.stopped;
    expect(stuck.kill).not.toHaveBeenCalledWith('SIGKILL');
    await finishPendingPtyStops();
    if (process.platform !== 'win32') {
      expect(stuck.kill).toHaveBeenCalledWith('SIGKILL');
    }
    stuck.notifyExit();
  });
});
