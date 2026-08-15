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
  // Mirrors the real Invoke uv.lock shape as closely as a fixture can: one torch build per platform (pypi + each
  // pytorch index), the torch dependency inline-tables (`{ name = "filelock", ... }`) that must not be mistaken for the
  // package name/source, plus the constructs a naive parser trips over - `resolution-markers`, `wheels`/`sdist` lists
  // carrying pytorch-index URLs, `[package.optional-dependencies]` / `[package.metadata]` sub-sections, and
  // same-name blocks split only by their resolution markers.
  const uvLock = `version = 1
revision = 3
requires-python = ">=3.11"
resolution-markers = [
    "python_full_version >= '3.12' and sys_platform == 'linux'",
    "python_full_version < '3.12' and sys_platform == 'win32'",
]

[[package]]
name = "numpy"
version = "2.1.3"
source = { registry = "https://pypi.org/simple" }
sdist = { url = "https://files.pythonhosted.org/packages/nu/numpy-2.1.3.tar.gz", hash = "sha256:aaaa" }
wheels = [
    { url = "https://files.pythonhosted.org/packages/nu/numpy-2.1.3-cp312-win_amd64.whl", hash = "sha256:bbbb" },
]

[[package]]
name = "accelerate"
version = "1.14.0"
source = { registry = "https://pypi.org/simple" }
dependencies = [
    { name = "torch", version = "2.7.1+cu128", source = { registry = "https://download.pytorch.org/whl/cu128" } },
    { name = "torch", version = "2.10.0+rocm7.1", source = { registry = "https://download.pytorch.org/whl/rocm7.1" } },
]

[package.optional-dependencies]
testing = [
    { name = "torch", version = "2.7.1+cu128", source = { registry = "https://download.pytorch.org/whl/cu128" } },
]

[package.metadata]
requires-dist = [
    { name = "torch", specifier = ">=2.7.1" },
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
wheels = [
    { url = "https://download-r2.pytorch.org/whl/cpu/torch-2.7.1%2Bcpu-cp312-cp312-win_amd64.whl", hash = "sha256:cccc" },
]

[[package]]
name = "torch"
version = "2.7.1+cu128"
source = { registry = "https://download.pytorch.org/whl/cu128" }
resolution-markers = [
    "python_full_version >= '3.12' and sys_platform == 'linux'",
]
wheels = [
    { url = "https://download-r2.pytorch.org/whl/cu128/torch-2.7.1%2Bcu128-cp312-cp312-manylinux_2_28_x86_64.whl", hash = "sha256:dddd" },
]

[[package]]
name = "torch"
version = "2.7.1+cu128"
source = { registry = "https://download.pytorch.org/whl/cu128" }
resolution-markers = [
    "python_full_version < '3.12' and sys_platform == 'win32'",
]

[[package]]
name = "torch"
version = "2.10.0+rocm7.1"
source = { registry = "https://download.pytorch.org/whl/rocm7.1" }

[[package]]
name = "torchvision"
version = "0.22.1+cpu"
source = { registry = "https://download.pytorch.org/whl/cpu" }

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
resolution-markers = [
    "python_full_version >= '3.12' and sys_platform == 'linux'",
]

[[package]]
name = "xformers"
version = "0.0.31.post1"
source = { registry = "https://pypi.org/simple" }
resolution-markers = [
    "python_full_version < '3.12' and sys_platform == 'win32'",
]
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

  it('selects the cpu builds for the cpu platform', () => {
    expect(getTorchPackagesFromLock(uvLock, 'cpu')).toEqual([
      { name: 'torch', version: '2.7.1' },
      { name: 'torchvision', version: '0.22.1' },
    ]);
  });

  it('returns each package once even when the lock splits it across resolution markers', () => {
    // uv emits several same-name blocks with the same source when the resolution differs per marker. Emitting
    // `torch==A torch==B` in one install command would be unsatisfiable.
    const names = getTorchPackagesFromLock(uvLock, 'cuda').map((pkg) => pkg.name);
    expect(names.filter((name) => name === 'torch')).toHaveLength(1);
  });

  it('ignores pytorch-index URLs that appear only in a wheels list', () => {
    // The cpu block's `wheels` entry points at a cu128 URL in this fixture only via the r2 host; selection must key off
    // the package's own top-level `source`, not any URL in the block.
    const names = getTorchPackagesFromLock(uvLock, 'cuda').map((pkg) => pkg.name);
    expect(names).toEqual(['torch', 'torchvision']);
  });

  it('matches the r2 host the pytorch registry is migrating to', () => {
    const r2Lock = `version = 1

[[package]]
name = "torch"
version = "2.7.1+cu128"
source = { registry = "https://download-r2.pytorch.org/whl/cu128" }
`;
    expect(getTorchPackagesFromLock(r2Lock, 'cuda')).toEqual([{ name: 'torch', version: '2.7.1' }]);
  });

  it('matches the nightly and test channels', () => {
    const nightlyLock = `version = 1

[[package]]
name = "torch"
version = "2.9.0.dev20250101+cu128"
source = { registry = "https://download.pytorch.org/whl/nightly/cu128" }

[[package]]
name = "torchvision"
version = "0.24.0+cpu"
source = { registry = "https://download.pytorch.org/whl/test/cpu" }
`;
    expect(getTorchPackagesFromLock(nightlyLock, 'cuda')).toEqual([{ name: 'torch', version: '2.9.0.dev20250101' }]);
    expect(getTorchPackagesFromLock(nightlyLock, 'cpu')).toEqual([{ name: 'torchvision', version: '0.24.0' }]);
  });

  it('does not match a lookalike host', () => {
    const lookalikeLock = `version = 1

[[package]]
name = "torch"
version = "2.7.1+cu128"
source = { registry = "https://notpytorch.org/whl/cu128" }
`;
    expect(getTorchPackagesFromLock(lookalikeLock, 'cuda')).toEqual([]);
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
