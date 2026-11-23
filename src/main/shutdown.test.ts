import { describe, expect, it, vi } from 'vitest';

import { createBeforeQuitHandler } from './shutdown';

describe('application shutdown', () => {
  it('holds reentrant quit requests until cleanup completes and lets the final quit through', async () => {
    let finish!: () => void;
    const cleanup = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const event = { preventDefault: vi.fn() };
    const quit = vi.fn(() => beforeQuit(event));
    const beforeQuit = createBeforeQuitHandler(cleanup, quit);
    beforeQuit(event);
    beforeQuit(event);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalledTimes(2);
    expect(quit).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() => expect(quit).toHaveBeenCalledOnce());
    expect(event.preventDefault).toHaveBeenCalledTimes(2);
  });

  it('still allows normal exit if a cleanup hook fails', async () => {
    const failure = new Error('cleanup failed');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const quit = vi.fn();
      const beforeQuit = createBeforeQuitHandler(() => Promise.reject(failure), quit);
      beforeQuit({ preventDefault: vi.fn() });
      await vi.waitFor(() => expect(quit).toHaveBeenCalledOnce());
      expect(log).toHaveBeenCalledWith(expect.any(String), failure);
    } finally {
      log.mockRestore();
    }
  });
});
