import { afterEach, describe, expect, it, vi } from 'vitest';

type WindowsConfig = { win: { artifactName?: string }; publish: { channel?: string } };

const loadConfig = async (): Promise<WindowsConfig> => {
  vi.resetModules();
  const mod = await import('./electron-builder.config');
  return mod.default as unknown as WindowsConfig;
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Windows build architecture', () => {
  it('keeps the historical installer name and the default update channel for x64', async () => {
    vi.stubEnv('LAUNCHER_WIN_ARCH', '');
    const config = await loadConfig();
    expect(config.win.artifactName).toBeUndefined();
    expect(config.publish.channel).toBeUndefined();
  });

  it('gives the arm64 build its own installer name and update channel', async () => {
    // Both must hold together: a distinct installer without a distinct manifest would still route ARM64 launchers
    // to the x64 installer listed first in latest.yml.
    vi.stubEnv('LAUNCHER_WIN_ARCH', 'arm64');
    const config = await loadConfig();
    // eslint-disable-next-line no-template-curly-in-string -- electron-builder file-name macros, not a template
    expect(config.win.artifactName).toBe('${productName} Setup ${version}-arm64.${ext}');
    expect(config.publish.channel).toBe('latest-arm64');
  });
});
