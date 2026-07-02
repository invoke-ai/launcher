import { afterEach, describe, expect, it, vi } from 'vitest';

import { getInvokeReleaseInstallFiles, getPins } from './pins';

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
