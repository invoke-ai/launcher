import { describe, expect, it } from 'vitest';

import { DEFAULT_ENV } from '@/lib/pty-utils';

import { buildCustomIndexProbeCommand, buildCustomTorchInstallCommand, CUSTOM_TORCH_INDEX_NAME } from './torch-index';

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

const probe = (indexUrl: string, requirements: string[], baseEnv: Record<string, string> = {}, useUvConfig = false) =>
  buildCustomIndexProbeCommand({ pythonTarget: VENV, indexUrl, requirements, baseEnv, useUvConfig });

describe('buildCustomIndexProbeCommand', () => {
  it('resolves without installing anything', () => {
    const { args } = probe('https://download.pytorch.org/whl/cu126', ['torch==2.7.1']);
    expect(args.slice(0, 2)).toEqual(['pip', 'install']);
    expect(args).toContain('--dry-run');
    expect(args).toContain('--no-deps');
    expect(args[args.indexOf('--python') + 1]).toBe(VENV);
  });

  it('makes the custom index the only index, so uv cannot fall back to another one', () => {
    // This is the whole point of the probe. Registered *alongside* other indexes - which the real install has to do so
    // torch's CUDA runtime still comes from PyPI - uv skips an index that rejects a request and resolves from the next
    // one, silently and with exit code 0. Measured on the bundled uv against `whl/cu1266` (a one-character typo that
    // answers 403): alongside PyPI it yields the PyPI torch, alongside a pinned index it yields that index's build.
    const { args } = probe('https://download.pytorch.org/whl/cu126', ['torch==2.7.1']);
    expect(args).toContain(`--default-index=${CUSTOM_TORCH_INDEX_NAME}=https://download.pytorch.org/whl/cu126`);
    expect(args.some((arg) => arg.startsWith('--index='))).toBe(false);
    expect(args).not.toContain('--index');
  });

  it('asks for exactly the requirements it is given', () => {
    const { args } = probe('https://download.pytorch.org/whl/cu126', ['torch==2.7.1', 'torchvision==0.22.1']);
    expect(args.slice(-2)).toEqual(['torch==2.7.1', 'torchvision==0.22.1']);
  });

  it('passes index credentials via the environment, never in argv', () => {
    const { args, env } = probe('https://myuser:ghp_TOKEN@nexus.corp/simple', ['torch']);
    expect(args).toContain(`--default-index=${CUSTOM_TORCH_INDEX_NAME}=https://nexus.corp/simple`);
    expect(args.join(' ')).not.toContain('ghp_TOKEN');
    expect(env).toMatchObject({
      UV_INDEX_INVOKE_CUSTOM_TORCH_USERNAME: 'myuser',
      UV_INDEX_INVOKE_CUSTOM_TORCH_PASSWORD: 'ghp_TOKEN',
    });
  });

  it('adds no credential environment for a credential-free index', () => {
    const { env } = probe('https://download.pytorch.org/whl/cu126', ['torch']);
    expect(Object.keys(env).filter((name) => name.startsWith('UV_INDEX_INVOKE_CUSTOM_TORCH'))).toEqual([]);
  });
});

describe('buildCustomIndexProbeCommand isolation', () => {
  it('ignores uv config, which would otherwise answer for the index under test', () => {
    // Measured against the bundled uv: an `[[index]]` in the user's uv.toml outranks `--default-index`, so without
    // this the probe resolves torch from that index and passes for any URL at all, typo included.
    const { args } = probe('https://download.pytorch.org/whl/cu126', ['torch']);
    expect(args).toContain('--no-config');
  });

  it('can be asked to apply uv config, for the retry that rules out a credentials-only failure', () => {
    const { args } = probe('https://download.pytorch.org/whl/cu126', ['torch'], {}, true);
    expect(args).not.toContain('--no-config');
  });

  it('neutralizes every ambient index setting in the environment uv is actually spawned with', () => {
    // `--no-config` closes the config file route but not this one, and the install manager builds its environment from
    // the user's login shell. `UV_INDEX` exported from a .bashrc adds an index that outranks `--default-index`, so a
    // typo'd custom index resolves from that instead and the probe passes - the same rubber stamp, another door.
    //
    // Asserted through the spawn-time merge on purpose. What we return is layered *over* `process.env`
    // (`createPtyProcess`: `{ ...process.env, ...DEFAULT_ENV, ...options.env }`), so deleting a key here would leave
    // it in place for any variable the launcher was itself started with - a Windows user-level variable, a Linux
    // session variable, or any launch from a terminal. Only an empty value survives that merge, and uv reads these as
    // unset. Asserting on the returned object alone would pass either way.
    const ambient = {
      UV_INDEX: 'https://download.pytorch.org/whl/cu128',
      UV_EXTRA_INDEX_URL: 'https://download.pytorch.org/whl/cu128',
      UV_FIND_LINKS: 'https://download.pytorch.org/whl/cu128/torch/',
      UV_DEFAULT_INDEX: 'https://download.pytorch.org/whl/cu128',
      UV_INDEX_URL: 'https://download.pytorch.org/whl/cu128',
    };

    const { env } = probe('https://download.pytorch.org/whl/cu126', ['torch'], { PATH: '/usr/bin', ...ambient });

    // `ambient` stands in for a `process.env` that already carries them.
    const asSpawned: Record<string, string> = { ...ambient, ...DEFAULT_ENV, ...env };
    for (const name of Object.keys(ambient)) {
      expect(asSpawned[name]).toBe('');
    }
  });

  it('keeps the rest of the environment, which carries the proxy and TLS settings uv needs', () => {
    const { env } = probe('https://download.pytorch.org/whl/cu126', ['torch'], {
      HTTPS_PROXY: 'http://proxy.corp:3128',
      SSL_CERT_FILE: '/etc/ssl/corp.pem',
      NETRC: '/home/user/.netrc',
    });
    expect(env).toMatchObject({
      HTTPS_PROXY: 'http://proxy.corp:3128',
      SSL_CERT_FILE: '/etc/ssl/corp.pem',
      NETRC: '/home/user/.netrc',
    });
  });
});
