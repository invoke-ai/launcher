// @vitest-environment jsdom

/* eslint-disable @typescript-eslint/no-explicit-any */

import * as pty from 'node-pty';
import { assert } from 'tsafe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PtyManager, PtyNotFound } from '@/lib/pty';

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

  it('should create a new pty entry', () => {
    const onData = vi.fn();
    const onExit = vi.fn();
    const entry = ptyManager.create({ onData, onExit });

    expect(entry).toBeDefined();
    expect(pty.spawn).toHaveBeenCalled();
    expect(mockPtyProcess.onData).toHaveBeenCalled();
    expect(mockPtyProcess.onExit).toHaveBeenCalled();
  });

  it('should store the created pty entry', () => {
    const onData = vi.fn();
    const onExit = vi.fn();
    const entry = ptyManager.create({ onData, onExit });

    expect(ptyManager.ptys.get(entry.id)).toBe(entry);
  });

  it('should write data to the pty process', () => {
    const onData = vi.fn();
    const onExit = vi.fn();
    const entry = ptyManager.create({ onData, onExit });

    ptyManager.write(entry.id, 'test data');
    expect(mockPtyProcess.write).toHaveBeenCalledWith('test data');
  });

  it('should resize the pty process', () => {
    const onData = vi.fn();
    const onExit = vi.fn();
    const entry = ptyManager.create({ onData, onExit });

    ptyManager.resize(entry.id, 1337, 90001);
    expect(mockPtyProcess.resize).toHaveBeenCalledWith(1337, 90001);
  });

  it('should replay the buffer', () => {
    const onData = vi.fn();
    const onExit = vi.fn();
    const entry = ptyManager.create({ onData, onExit });
    const data = 'test data';
    entry.historyBuffer.push(data);
    const replayData = ptyManager.replay(entry.id);
    expect(replayData).toBe(data);
  });

  it('should dispose of the pty process', () => {
    const onData = vi.fn();
    const onExit = vi.fn();
    const entry = ptyManager.create({ onData, onExit });

    ptyManager.dispose(entry.id);
    expect(mockPtyProcess.kill).toHaveBeenCalled();
    expect(ptyManager.ptys.has(entry.id)).toBe(false);
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
    const entry1 = ptyManager.create({ onData, onExit });
    const entry2 = ptyManager.create({ onData, onExit });

    const ids = ptyManager.list();
    expect(ids).toContain(entry1.id);
    expect(ids).toContain(entry2.id);
    expect(ids).toHaveLength(2);
  });

  it('should run a command and wait for completion', async () => {
    const onData = vi.fn();
    const onExit = vi.fn();
    const entry = ptyManager.create({ onData, onExit });

    // Setup mock behavior for command execution
    mockPtyProcess.write.mockImplementation((data: string) => {
      // Extract the marker from the command
      const markerMatch = data.match(/__CMD_MARKER_(.+?)__/);
      if (markerMatch) {
        const marker = `__CMD_MARKER_${markerMatch[1]}__`;
        // Simulate output with the marker and exit code 0
        const callback = mockPtyProcess.onData.mock.calls[0][0];
        setTimeout(() => {
          callback(`command output\r\n${marker}:0\r\n`);
        }, 10);
      }
    });

    const result = await ptyManager.runCommand(entry.id, 'echo "test"');

    assert(result !== PtyNotFound);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('command output');
    expect(mockPtyProcess.write).toHaveBeenCalled();
  });

  it('should handle command failure correctly', async () => {
    const onData = vi.fn();
    const onExit = vi.fn();
    const entry = ptyManager.create({ onData, onExit });

    mockPtyProcess.write.mockImplementation((data: string) => {
      const markerMatch = data.match(/__CMD_MARKER_(.+?)__/);
      if (markerMatch) {
        const marker = `__CMD_MARKER_${markerMatch[1]}__`;
        const callback = mockPtyProcess.onData.mock.calls[0][0];
        setTimeout(() => {
          callback(`error output\r\n${marker}:1\r\n`);
        }, 10);
      }
    });

    const result = await ptyManager.runCommand(entry.id, 'invalid_command');

    assert(result !== PtyNotFound);
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('error output');
  });

  it('should reject commands when PTY is disposed', async () => {
    const onData = vi.fn();
    const onExit = vi.fn();
    const entry = ptyManager.create({ onData, onExit });

    // Start a command but don't let it complete
    const commandPromise = ptyManager.runCommand(entry.id, 'long_running_command');

    // Dispose the PTY before the command completes
    ptyManager.dispose(entry.id);

    // The command should reject
    await expect(commandPromise).rejects.toThrow('PTY was disposed');
  });

  it('should handle command timeout', async () => {
    const onData = vi.fn();
    const onExit = vi.fn();
    const entry = ptyManager.create({ onData, onExit });

    // Command that won't complete in time
    mockPtyProcess.write.mockImplementation(() => {
      // Never send the completion marker
    });

    const commandPromise = ptyManager.runCommand(entry.id, 'hang', { timeout: 50 });

    await expect(commandPromise).rejects.toThrow('Command timed out');
  });
});
