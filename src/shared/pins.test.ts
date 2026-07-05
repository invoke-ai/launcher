import { afterEach, describe, expect, it, vi } from 'vitest';

import { getInvokeReleaseInstallFiles, getPins, getTorchPackagesFromLock } from './pins';

const pins = {
  python: '3.12',
  torchIndexUrl: {
    win32: {
      cuda: 'https://download.pytorch.org/whl/cu128',
    },
    linux: {
      cpu: 'https://download.pytorch.org/whl/cpu',
      rocm: 'https://download.pytorch.org/whl/rocm7.1',
      cuda: 'https://download.pytorch.org/whl/cu128',
    },
    darwin: {},
  },
};

describe('pins', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches install files from the selected invoke release', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith('/pins.json')) {
        return new Response(JSON.stringify(pins));
      }
      if (url.endsWith('/pyproject.toml')) {
        return new Response('[project]\nname = "InvokeAI"\n');
      }
      if (url.endsWith('/uv.lock')) {
        return new Response('version = 1\n');
      }
      return new Response('', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const files = await getInvokeReleaseInstallFiles('6.14.0');

    expect(files).toEqual({
      pins,
      pyprojectToml: '[project]\nname = "InvokeAI"\n',
      uvLock: 'version = 1\n',
    });
    expect(fetchMock).toHaveBeenCalledWith('https://raw.githubusercontent.com/invoke-ai/InvokeAI/v6.14.0/pins.json');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/invoke-ai/InvokeAI/v6.14.0/pyproject.toml'
    );
    expect(fetchMock).toHaveBeenCalledWith('https://raw.githubusercontent.com/invoke-ai/InvokeAI/v6.14.0/uv.lock');
  });

  it('falls back to jsdelivr when fetching legacy pins', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(pins)));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getPins('6.13.0')).resolves.toEqual(pins);
    expect(fetchMock).toHaveBeenCalledWith('https://raw.githubusercontent.com/invoke-ai/InvokeAI/v6.13.0/pins.json');
    expect(fetchMock).toHaveBeenCalledWith('https://cdn.jsdelivr.net/gh/invoke-ai/InvokeAI@v6.13.0/pins.json');
    expect(warnSpy).toHaveBeenCalledOnce();
  });
});

describe('getTorchPackagesFromLock', () => {
  // Mirrors the real Invoke uv.lock shape: one torch build per platform (pypi + each pytorch index), with the torch
  // dependency inline-tables (`{ name = "filelock", ... }`) that must not be mistaken for the package name/source.
  const uvLock = `version = 1
revision = 1
requires-python = ">=3.11"

[[package]]
name = "numpy"
version = "2.1.3"
source = { registry = "https://pypi.org/simple" }

[[package]]
name = "accelerate"
version = "1.14.0"
source = { registry = "https://pypi.org/simple" }
dependencies = [
    { name = "torch", version = "2.7.1+cu128", source = { registry = "https://download.pytorch.org/whl/cu128" } },
    { name = "torch", version = "2.10.0+rocm7.1", source = { registry = "https://download.pytorch.org/whl/rocm7.1" } },
]

[[package]]
name = "torch"
version = "2.7.1"
source = { registry = "https://pypi.org/simple" }
dependencies = [
    { name = "filelock" },
    { name = "fsspec" },
]

[[package]]
name = "torch"
version = "2.7.1+cpu"
source = { registry = "https://download.pytorch.org/whl/cpu" }

[[package]]
name = "torch"
version = "2.7.1+cu128"
source = { registry = "https://download.pytorch.org/whl/cu128" }

[[package]]
name = "torch"
version = "2.10.0+rocm7.1"
source = { registry = "https://download.pytorch.org/whl/rocm7.1" }

[[package]]
name = "torchvision"
version = "0.22.1+cu128"
source = { registry = "https://download.pytorch.org/whl/cu128" }

[[package]]
name = "torchvision"
version = "0.25.0+rocm7.1"
source = { registry = "https://download.pytorch.org/whl/rocm7.1" }

[[package]]
name = "triton-rocm"
version = "3.6.0"
source = { registry = "https://download.pytorch.org/whl/rocm7.1" }

[[package]]
name = "xformers"
version = "0.0.31.post1"
source = { registry = "https://pypi.org/simple" }
`;

  it('returns only the selected platform torch packages, with local version tags stripped', () => {
    expect(getTorchPackagesFromLock(uvLock, 'cuda')).toEqual([
      { name: 'torch', version: '2.7.1' },
      { name: 'torchvision', version: '0.22.1' },
    ]);
  });

  it('selects the rocm builds (different versions) for the rocm platform', () => {
    expect(getTorchPackagesFromLock(uvLock, 'rocm')).toEqual([
      { name: 'torch', version: '2.10.0' },
      { name: 'torchvision', version: '0.25.0' },
      { name: 'triton-rocm', version: '3.6.0' },
    ]);
  });

  it('selects the cpu build for the cpu platform', () => {
    expect(getTorchPackagesFromLock(uvLock, 'cpu')).toEqual([{ name: 'torch', version: '2.7.1' }]);
  });

  it('ignores packages resolved from pypi (e.g. the generic torch build, xformers)', () => {
    const names = getTorchPackagesFromLock(uvLock, 'cuda').map((pkg) => pkg.name);
    expect(names).not.toContain('numpy');
    expect(names).not.toContain('xformers');
    // The pypi torch build is 2.7.1 with no local tag; the cuda build we return is also base 2.7.1 - assert we only
    // returned torch once (from the cu128 source), not twice.
    expect(names.filter((n) => n === 'torch')).toHaveLength(1);
  });

  it('does not match torch sources nested inside another package’s dependencies list', () => {
    // `accelerate` is a pypi package that lists torch (with a pytorch-index source) in its dependencies. It must not
    // be reported as a torch-index package itself.
    const names = getTorchPackagesFromLock(uvLock, 'cuda').map((pkg) => pkg.name);
    expect(names).not.toContain('accelerate');
  });

  it('returns an empty array when the platform has no pytorch-index torch (e.g. macOS/pypi-only)', () => {
    const lockWithoutTorch = `version = 1

[[package]]
name = "torch"
version = "2.7.1"
source = { registry = "https://pypi.org/simple" }
`;
    expect(getTorchPackagesFromLock(lockWithoutTorch, 'cuda')).toEqual([]);
  });
});
