import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ dialog: {} }));
vi.mock('electron-updater', () => ({ default: { autoUpdater: {} } }));
vi.mock('./store', () => ({ store: { get: () => false } }));

import { isWindowsArm64Build, shouldAllowPrerelease } from '@/main/updater';

describe('isWindowsArm64Build', () => {
  it('is decided by the binary architecture, not the machine', () => {
    expect(isWindowsArm64Build('win32', 'arm64')).toBe(true);
    // An x64 launcher under emulation on an ARM64 machine is still the x64 build and follows the x64 channel.
    expect(isWindowsArm64Build('win32', 'x64')).toBe(false);
    expect(isWindowsArm64Build('darwin', 'arm64')).toBe(false);
    expect(isWindowsArm64Build('linux', 'x64')).toBe(false);
  });
});

describe('shouldAllowPrerelease', () => {
  it('honours the opt-in everywhere but the Windows ARM64 build', () => {
    expect(shouldAllowPrerelease(true, 'win32', 'x64')).toBe(true);
    expect(shouldAllowPrerelease(true, 'darwin', 'arm64')).toBe(true);
    expect(shouldAllowPrerelease(true, 'linux', 'x64')).toBe(true);
    expect(shouldAllowPrerelease(false, 'win32', 'x64')).toBe(false);
  });

  it('never follows prereleases on the Windows ARM64 build', () => {
    // latest-arm64.yml exists only for stable releases; electron-updater's prerelease path would fall back to
    // latest.yml and hand this build the x64 installer.
    expect(shouldAllowPrerelease(true, 'win32', 'arm64')).toBe(false);
    expect(shouldAllowPrerelease(false, 'win32', 'arm64')).toBe(false);
  });
});
