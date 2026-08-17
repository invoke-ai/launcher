import { describe, expect, it } from 'vitest';

import { buildCustomTorchInstallCommand, CUSTOM_TORCH_INDEX_NAME } from './torch-index';

const VENV = '/home/user/invokeai/.venv';
const PACKAGES = [
  { name: 'torch', version: '2.7.1' },
  { name: 'torchvision', version: '0.22.1' },
];

describe('buildCustomTorchInstallCommand', () => {
  it('installs the requested packages at their tag-stripped versions', () => {
    const { args } = buildCustomTorchInstallCommand(VENV, 'https://download.pytorch.org/whl/cu126', PACKAGES);
    expect(args.slice(0, 2)).toEqual(['pip', 'install']);
    expect(args).toContain('torch==2.7.1');
    expect(args).toContain('torchvision==0.22.1');
    expect(args).toContain('--python');
    expect(args[args.indexOf('--python') + 1]).toBe(VENV);
  });

  it('adds the custom index alongside PyPI, pinned to the first-index strategy', () => {
    const { args } = buildCustomTorchInstallCommand(VENV, 'https://download.pytorch.org/whl/cu126', PACKAGES);
    expect(args).toContain(`--index=${CUSTOM_TORCH_INDEX_NAME}=https://download.pytorch.org/whl/cu126`);
    expect(args[args.indexOf('--index-strategy') + 1]).toBe('first-index');
    // `--index-url` / `--default-index` would make the custom index the *sole* index, which would also cut off torch's
    // CUDA runtime dependencies (`nvidia-*-cu12`, `triton`) - those are published on PyPI.
    expect(args.some((arg) => arg.startsWith('--index-url') || arg.startsWith('--default-index'))).toBe(false);
  });

  it('resolves dependencies so the CUDA runtime matches the custom torch build', () => {
    // On Linux, torch's `nvidia-*-cu12` runtime is resolved from PyPI and pinned exactly by the torch wheel metadata.
    // With `--no-deps`, `uv sync` would leave the lock's (e.g. cu128) runtime in place under a cu126 torch, and the
    // install would still report success.
    const { args } = buildCustomTorchInstallCommand(VENV, 'https://download.pytorch.org/whl/cu126', PACKAGES);
    expect(args).not.toContain('--no-deps');
  });

  it('force-reinstalls only the torch packages, not every resolved dependency', () => {
    const { args } = buildCustomTorchInstallCommand(VENV, 'https://download.pytorch.org/whl/cu126', PACKAGES);
    expect(args).not.toContain('--force-reinstall');
    const reinstalled = args.filter((arg, i) => args[i - 1] === '--reinstall-package');
    expect(reinstalled).toEqual(['torch', 'torchvision']);
  });

  it('passes index credentials via the environment, never in argv', () => {
    const { args, env } = buildCustomTorchInstallCommand(VENV, 'https://myuser:ghp_TOKEN@nexus.corp/simple', PACKAGES);
    expect(args).toContain(`--index=${CUSTOM_TORCH_INDEX_NAME}=https://nexus.corp/simple`);
    expect(args.join(' ')).not.toContain('ghp_TOKEN');
    expect(args.join(' ')).not.toContain('myuser');
    expect(env).toEqual({
      UV_INDEX_INVOKE_CUSTOM_TORCH_USERNAME: 'myuser',
      UV_INDEX_INVOKE_CUSTOM_TORCH_PASSWORD: 'ghp_TOKEN',
    });
  });

  it('adds no environment for a credential-free index', () => {
    const { env } = buildCustomTorchInstallCommand(VENV, 'https://download.pytorch.org/whl/cu126', PACKAGES);
    expect(env).toEqual({});
  });
});
