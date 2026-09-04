import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildCustomTorchInstallCommand, checkIndexServesPackages, CUSTOM_TORCH_INDEX_NAME } from './torch-index';

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

describe('checkIndexServesPackages', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks the index for each package under its PEP 503 normalized name', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await checkIndexServesPackages('https://download.pytorch.org/whl/cu126', ['torch', 'triton_rocm']);

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      'https://download.pytorch.org/whl/cu126/torch/',
      'https://download.pytorch.org/whl/cu126/triton-rocm/',
    ]);
  });

  it('reports a package the index does not serve', async () => {
    // uv reads a 404 as "not published on this index", falls through to PyPI and installs the default build without
    // an error - the one silent path `--index-strategy first-index` does not cover.
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, _init?: RequestInit) => new Response('', { status: url.endsWith('/torch/') ? 404 : 200 }))
    );

    const checks = await checkIndexServesPackages('https://download.pytorch.org/whl/cu1266', ['torch', 'torchvision']);

    expect(checks).toEqual([
      { name: 'torch', verdict: 'not-served', detail: 'HTTP 404' },
      { name: 'torchvision', verdict: 'served', detail: 'HTTP 200' },
    ]);
  });

  it('distinguishes an unreachable index from one that does not serve the package', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, _init?: RequestInit) => Promise.reject(new Error('getaddrinfo ENOTFOUND nexus.corp')))
    );

    const [check] = await checkIndexServesPackages('https://nexus.corp/simple', ['torch']);

    // 'unknown' is what keeps the install manager from treating an unreachable index as a refusal.
    expect(check?.verdict).toBe('unknown');
    expect(check?.detail).toContain('could not reach the index');
  });

  it('authenticates with the credentials embedded in the index URL', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await checkIndexServesPackages('https://myuser:ghp_TOKEN@nexus.corp/simple', ['torch']);

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://nexus.corp/simple/torch/');
    const init = fetchMock.mock.calls[0]?.[1] as unknown as { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('myuser:ghp_TOKEN').toString('base64')}`);
  });

  it('keeps a path-style index URL intact when it has no trailing slash', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await checkIndexServesPackages('https://nexus.corp/repository/pypi/simple', ['torch']);

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://nexus.corp/repository/pypi/simple/torch/');
  });
});

describe('checkIndexServesPackages verdicts', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const checkWithStatus = async (status: number) => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, _init?: RequestInit) => new Response('', { status }))
    );
    const [check] = await checkIndexServesPackages('https://nexus.corp/simple', ['torch']);
    return check?.verdict;
  };

  it('treats "the index does not have this project" as not-served', async () => {
    await expect(checkWithStatus(404)).resolves.toBe('not-served');
    await expect(checkWithStatus(403)).resolves.toBe('not-served');
    await expect(checkWithStatus(410)).resolves.toBe('not-served');
  });

  it('does not treat an auth challenge as proof the package is missing', async () => {
    // uv also reads `.netrc` and the system keyring, so it can authenticate where this check cannot. Blocking on a 401
    // would lock those users out of the feature with an error message that is simply untrue.
    await expect(checkWithStatus(401)).resolves.toBe('unknown');
    // 407 is the proxy talking, not the index - and Node's fetch ignores the proxy variables uv honours.
    await expect(checkWithStatus(407)).resolves.toBe('unknown');
  });

  it('does not block on a server-side failure', async () => {
    await expect(checkWithStatus(500)).resolves.toBe('unknown');
    await expect(checkWithStatus(429)).resolves.toBe('unknown');
  });

  it('keeps a query string on the index URL', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await checkIndexServesPackages('https://nexus.corp/simple?token=abc', ['torch']);

    // Resolving `torch/` as a relative URL would drop the token and hit `/torch/` at the host root.
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://nexus.corp/simple/torch/?token=abc');
  });
});
