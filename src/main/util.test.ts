import { afterEach, describe, expect, it, vi } from 'vitest';

// util.ts imports electron for its window helpers; none of the functions under test touch it.
vi.mock('electron', () => ({ app: {}, screen: {} }));

const originalPlatform = process.platform;
const originalArch = process.arch;

const setProcess = (platform: NodeJS.Platform, arch: NodeJS.Architecture) => {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  Object.defineProperty(process, 'arch', { value: arch, configurable: true });
};

/**
 * `isWindowsArm64` caches its answer for the process lifetime, so each scenario gets a fresh module. An x64 launcher
 * on the test machine has no `reg.exe` to query, so the emulated-on-ARM64 case is driven through the environment here;
 * the registry path itself is covered through `detectWindowsArm64`.
 */
const loadUtil = async (platform: NodeJS.Platform, arch: NodeJS.Architecture, envMachine?: string) => {
  setProcess(platform, arch);
  if (envMachine === undefined) {
    delete process.env.PROCESSOR_ARCHITECTURE;
  } else {
    process.env.PROCESSOR_ARCHITECTURE = envMachine;
  }
  vi.resetModules();
  return await import('@/main/util');
};

const originalEnvMachine = process.env.PROCESSOR_ARCHITECTURE;

afterEach(() => {
  setProcess(originalPlatform, originalArch);
  if (originalEnvMachine === undefined) {
    delete process.env.PROCESSOR_ARCHITECTURE;
  } else {
    process.env.PROCESSOR_ARCHITECTURE = originalEnvMachine;
  }
});

describe('detectWindowsArm64', () => {
  const probe = (
    platform: NodeJS.Platform,
    arch: NodeJS.Architecture,
    env: NodeJS.ProcessEnv,
    nativeArch: string | undefined
  ) => ({ platform, arch, env, readNativeArch: vi.fn(() => nativeArch) });

  it('is true for a native ARM64 launcher without consulting the registry', async () => {
    const { detectWindowsArm64 } = await loadUtil(originalPlatform, originalArch);
    const p = probe('win32', 'arm64', {}, undefined);
    expect(detectWindowsArm64(p)).toBe(true);
    expect(p.readNativeArch).not.toHaveBeenCalled();
  });

  it('is true for an x64 launcher emulated on an ARM64 machine', async () => {
    // Windows gives an emulated x64 process PROCESSOR_ARCHITECTURE=AMD64 and no PROCESSOR_ARCHITEW6432, so only the
    // registry's system value tells it the machine is ARM64.
    const { detectWindowsArm64 } = await loadUtil(originalPlatform, originalArch);
    expect(detectWindowsArm64(probe('win32', 'x64', { PROCESSOR_ARCHITECTURE: 'AMD64' }, 'ARM64'))).toBe(true);
  });

  it('is false on x64 Windows, when the registry cannot be read, and on every other OS', async () => {
    const { detectWindowsArm64 } = await loadUtil(originalPlatform, originalArch);
    expect(detectWindowsArm64(probe('win32', 'x64', { PROCESSOR_ARCHITECTURE: 'AMD64' }, 'AMD64'))).toBe(false);
    expect(detectWindowsArm64(probe('win32', 'x64', { PROCESSOR_ARCHITECTURE: 'AMD64' }, undefined))).toBe(false);
    const darwin = probe('darwin', 'arm64', { PROCESSOR_ARCHITECTURE: 'ARM64' }, 'ARM64');
    expect(detectWindowsArm64(darwin)).toBe(false);
    expect(darwin.readNativeArch).not.toHaveBeenCalled();
    expect(detectWindowsArm64(probe('linux', 'x64', {}, 'ARM64'))).toBe(false);
  });
});

describe('isWindowsArm64', () => {
  it('is false for an x64 launcher when the registry cannot be read', async () => {
    // There is no reg.exe here, so the query fails - which must read as "not ARM64", not throw.
    const { isWindowsArm64 } = await loadUtil('win32', 'x64', 'AMD64');
    expect(isWindowsArm64()).toBe(false);
  });
});

describe('getSystemArch', () => {
  it('reports the machine architecture on Windows, the binary architecture elsewhere', async () => {
    expect((await loadUtil('win32', 'arm64')).getSystemArch()).toBe('arm64');
    expect((await loadUtil('win32', 'x64', 'ARM64')).getSystemArch()).toBe('arm64');
    expect((await loadUtil('win32', 'x64', 'AMD64')).getSystemArch()).toBe('x64');
    expect((await loadUtil('linux', 'x64')).getSystemArch()).toBe('x64');
    expect((await loadUtil('darwin', 'arm64')).getSystemArch()).toBe('arm64');
  });
});

describe('getPythonRequest', () => {
  it('names the native ARM64 CPython on Windows ARM64', async () => {
    // A bare "3.12" makes uv install an x86_64 interpreter there, which cannot load the ARM64 torch wheel.
    expect((await loadUtil('win32', 'arm64')).getPythonRequest('3.12')).toBe('cpython-3.12-windows-aarch64-none');
    expect((await loadUtil('win32', 'x64', 'ARM64')).getPythonRequest('3.12')).toBe(
      'cpython-3.12-windows-aarch64-none'
    );
  });

  it('passes the pinned version through everywhere else', async () => {
    expect((await loadUtil('win32', 'x64', 'AMD64')).getPythonRequest('3.12')).toBe('3.12');
    expect((await loadUtil('linux', 'x64')).getPythonRequest('3.12')).toBe('3.12');
    expect((await loadUtil('darwin', 'arm64')).getPythonRequest('3.12')).toBe('3.12');
  });
});

describe('getTorchPlatform', () => {
  it('has no accelerator builds for AMD or Intel on Windows ARM64', async () => {
    const { getTorchPlatform } = await loadUtil('win32', 'arm64');
    expect(getTorchPlatform('amd')).toBe('cpu');
    expect(getTorchPlatform('intel')).toBe('cpu');
    expect(getTorchPlatform('nvidia>=30xx')).toBe('cuda');
    expect(getTorchPlatform('nogpu')).toBe('cpu');
  });

  it('keeps the x64 Windows and Linux matrix', async () => {
    const win = await loadUtil('win32', 'x64', 'AMD64');
    expect(win.getTorchPlatform('amd')).toBe('cpu');
    expect(win.getTorchPlatform('intel')).toBe('xpu');
    const linux = await loadUtil('linux', 'x64');
    expect(linux.getTorchPlatform('amd')).toBe('rocm');
    expect(linux.getTorchPlatform('intel')).toBe('xpu');
    const darwin = await loadUtil('darwin', 'arm64');
    expect(darwin.getTorchPlatform('nvidia>=30xx')).toBe('cpu');
  });
});
