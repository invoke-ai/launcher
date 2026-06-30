import { assert } from 'tsafe';
import { z } from 'zod';

const zPlatformIndicies = z.object({
  cuda: z.string().optional(),
  cpu: z.string().optional(),
  rocm: z.string().optional(),
});

const zPins = z.object({
  /**
   * The python version to use for the given version of the invokeai package.
   */
  python: z.string(),
  /**
   * Legacy index urls for the torch package for the given version of the invokeai package for each platform.
   *
   * These are retained for compatibility with the current pins.json shape. The installer syncs dependencies from the
   * selected Invoke release's pyproject.toml and uv.lock; these URLs are not used as dependency resolution authority.
   *
   * Each platform has a set of indices for each torch device.
   *
   * See: https://pytorch.org/get-started/previous-versions/
   */
  torchIndexUrl: z.object({
    win32: zPlatformIndicies,
    linux: zPlatformIndicies,
    darwin: zPlatformIndicies,
  }),
});
type Pins = z.infer<typeof zPins>;

export type InvokeReleaseInstallFiles = {
  tag: string;
  pins: Pins;
  pyprojectToml: string;
  uvLock: string;
};

export const getInvokeReleaseTag = (targetVersion: string): string => {
  return targetVersion.startsWith('v') ? targetVersion : `v${targetVersion}`;
};

const fetchInvokeReleaseFile = async (tag: string, filePath: string): Promise<string> => {
  for (const url of [
    `https://raw.githubusercontent.com/invoke-ai/InvokeAI/${tag}/${filePath}`,
    `https://cdn.jsdelivr.net/gh/invoke-ai/InvokeAI@${tag}/${filePath}`,
  ]) {
    console.log(`Fetching ${filePath} from ${url}`);
    try {
      const res = await fetch(url);
      assert(res.ok, 'Network error');
      return await res.text();
    } catch (err) {
      console.warn(`Failed to fetch ${filePath}`, err);
    }
  }

  throw new Error(`Failed to fetch ${filePath}`);
};

/**
 * Fetch the bootstrap pins required to install the target version.
 *
 * The pins are fetched from the GitHub repo.
 *
 * Note: Prior to Invoke v5.10.0, (e.g. v5.9.1 and earlier), we hardcoded the python version and
 * PyTorch indices in this launcher repo. This was problematic, because it meant we needed to
 * update the launcher whenever the app's PyTorch dependency or target python version changed.
 *
 * @param targetVersion - The version of the invokeai package
 * @returns Launcher bootstrap metadata. Dependency resolution is handled by the fetched pyproject.toml and uv.lock.
 * @throws If no pins are found for the given version
 */
export const getPins = async (targetVersion: string): Promise<Pins> => {
  const tag = getInvokeReleaseTag(targetVersion);

  for (const url of [
    `https://raw.githubusercontent.com/invoke-ai/InvokeAI/${tag}/pins.json`,
    `https://cdn.jsdelivr.net/gh/invoke-ai/InvokeAI@${tag}/pins.json`,
  ]) {
    console.log(`Fetching pins from ${url}`);
    try {
      const res = await fetch(url);
      assert(res.ok, 'Network error');
      const json = await res.json();
      const pins = zPins.parse(json);
      return pins;
    } catch (err) {
      console.warn('Failed to fetch pins', err);
    }
  }

  throw new Error('Failed to fetch pins');
};

export const getInvokeReleaseInstallFiles = async (targetVersion: string): Promise<InvokeReleaseInstallFiles> => {
  const tag = getInvokeReleaseTag(targetVersion);
  const [pinsJson, pyprojectToml, uvLock] = await Promise.all([
    fetchInvokeReleaseFile(tag, 'pins.json'),
    fetchInvokeReleaseFile(tag, 'pyproject.toml'),
    fetchInvokeReleaseFile(tag, 'uv.lock'),
  ]);

  return {
    tag,
    pins: zPins.parse(JSON.parse(pinsJson)),
    pyprojectToml,
    uvLock,
  };
};
