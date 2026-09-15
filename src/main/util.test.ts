import { afterEach, describe, expect, it, vi } from 'vitest';

// util.ts imports electron for its window helpers; none of the functions under test touch it.
vi.mock('electron', () => ({ app: {}, screen: {} }));

import { getPythonRequest, getSystemArch, getTorchPlatform, isWindowsArm64 } from '@/main/util';

const setProcess = (platform: NodeJS.Platform, arch: NodeJS.Architecture) => {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  Object.defineProperty(process, 'arch', { value: arch, configurable: true });
};

const originalPlatform = process.platform;
const originalArch = process.arch;

afterEach(() => {
  setProcess(originalPlatform, originalArch);
});

describe('isWindowsArm64', () => {
  it('is true for a native ARM64 launcher', () => {
    setProcess('win32', 'arm64');
    expect(isWindowsArm64({})).toBe(true);
  });

  it('is true for an x64 launcher emulated on an ARM64 machine', () => {
    // Windows reports the machine architecture to emulated processes through PROCESSOR_ARCHITEW6432.
    setProcess('win32', 'x64');
    expect(isWindowsArm64({ PROCESSOR_ARCHITECTURE: 'AMD64', PROCESSOR_ARCHITEW6432: 'ARM64' })).toBe(true);
    expect(isWindowsArm64({ PROCESSOR_ARCHITECTURE: 'arm64' })).toBe(true);
  });

  it('is false on x64 Windows and on every other OS', () => {
    setProcess('win32', 'x64');
    expect(isWindowsArm64({ PROCESSOR_ARCHITECTURE: 'AMD64' })).toBe(false);
    setProcess('darwin', 'arm64');
    expect(isWindowsArm64({ PROCESSOR_ARCHITECTURE: 'ARM64' })).toBe(false);
    setProcess('linux', 'x64');
    expect(isWindowsArm64({})).toBe(false);
  });
});

describe('getSystemArch', () => {
  it('reports the machine architecture on Windows, the binary architecture elsewhere', () => {
    setProcess('win32', 'arm64');
    expect(getSystemArch()).toBe('arm64');
    setProcess('linux', 'x64');
    expect(getSystemArch()).toBe('x64');
    setProcess('darwin', 'arm64');
    expect(getSystemArch()).toBe('arm64');
  });
});

describe('getPythonRequest', () => {
  it('names the native ARM64 CPython on Windows ARM64', () => {
    // A bare "3.12" makes uv install an x86_64 interpreter there, which cannot load the ARM64 torch wheel.
    setProcess('win32', 'arm64');
    expect(getPythonRequest('3.12')).toBe('cpython-3.12-windows-aarch64-none');
  });

  it('passes the pinned version through everywhere else', () => {
    setProcess('win32', 'x64');
    expect(getPythonRequest('3.12')).toBe('3.12');
    setProcess('linux', 'x64');
    expect(getPythonRequest('3.12')).toBe('3.12');
    setProcess('darwin', 'arm64');
    expect(getPythonRequest('3.12')).toBe('3.12');
  });
});

describe('getTorchPlatform', () => {
  it('has no accelerator builds for AMD or Intel on Windows ARM64', () => {
    setProcess('win32', 'arm64');
    expect(getTorchPlatform('amd')).toBe('cpu');
    expect(getTorchPlatform('intel')).toBe('cpu');
    expect(getTorchPlatform('nvidia>=30xx')).toBe('cuda');
    expect(getTorchPlatform('nogpu')).toBe('cpu');
  });

  it('keeps the x64 Windows and Linux matrix', () => {
    setProcess('win32', 'x64');
    expect(getTorchPlatform('amd')).toBe('cpu');
    expect(getTorchPlatform('intel')).toBe('xpu');
    setProcess('linux', 'x64');
    expect(getTorchPlatform('amd')).toBe('rocm');
    expect(getTorchPlatform('intel')).toBe('xpu');
    setProcess('darwin', 'arm64');
    expect(getTorchPlatform('nvidia>=30xx')).toBe('cpu');
  });
});
