// @vitest-environment jsdom

/* eslint-disable @typescript-eslint/no-explicit-any */

import * as pty from 'node-pty';
import { assert } from 'tsafe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PtyManager } from '@/lib/pty';

vi.mock('node-pty');

describe('PtyManager', () => {
  let ptyManager: PtyManager;
  let mockPtyProcess: any;

  beforeEach(() => {
    (process as any).resourcesPath = '/mock/path';
    ptyManager = new PtyManager();
    mockPtyProcess = {
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
    };
    (pty.spawn as any).mockReturnValue(mockPtyProcess);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should create a new pty process', () => {
    const onData = vi.fn();
    const onExit = vi.fn();
    const id = ptyManager.create({ onData, onExit });

    expect(id).toBeDefined();
    expect(pty.spawn).toHaveBeenCalled();
    expect(mockPtyProcess.onData).toHaveBeenCalled();
    expect(mockPtyProcess.onExit).toHaveBeenCalled();
  });

  it('should write data to the pty process', () => {
    const onData = vi.fn();
    const onExit = vi.fn();
    const id = ptyManager.create({ onData, onExit });

    ptyManager.write(id, 'test data');
    expect(mockPtyProcess.write).toHaveBeenCalledWith('test data');
  });

  it('should resize the pty process', () => {
    const onData = vi.fn();
    const onExit = vi.fn();
    const id = ptyManager.create({ onData, onExit });

    ptyManager.resize(id, 1337, 90001);
    expect(mockPtyProcess.resize).toHaveBeenCalledWith(1337, 90001);
  });

  it('should replay the buffer', () => {
    const onData = vi.fn();
    const onExit = vi.fn();
    const id = ptyManager.create({ onData, onExit });
    const entry = ptyManager.ptys.get(id);
    assert(entry);
    const data = 'test data';
    entry.historyBuffer.push(data);
    const replayData = ptyManager.replay(id);
    expect(replayData).toBe(data);
  });

  it('should dispose of the pty process', () => {
    const onData = vi.fn();
    const onExit = vi.fn();
    const id = ptyManager.create({ onData, onExit });

    ptyManager.dispose(id);
    expect(mockPtyProcess.kill).toHaveBeenCalled();
    expect(ptyManager.ptys.has(id)).toBe(false);
  });

  it('should teardown all pty processes', () => {
    const onData = vi.fn();
    const onExit = vi.fn();
    ptyManager.create({ onData, onExit });
    ptyManager.create({ onData, onExit });

    ptyManager.teardown();
    expect(mockPtyProcess.kill).toHaveBeenCalledTimes(2);
    expect(ptyManager.ptys.size).toBe(0);
  });

  it('should list all pty ids', () => {
    const onData = vi.fn();
    const onExit = vi.fn();
    const id1 = ptyManager.create({ onData, onExit });
    const id2 = ptyManager.create({ onData, onExit });

    const ids = ptyManager.list();
    expect(ids).toContain(id1);
    expect(ids).toContain(id2);
    expect(ids).toHaveLength(2);
  });
});
