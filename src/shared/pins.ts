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
   * The index urls for the torch package for the given version of the invokeai package for each platform.
   *
   * The pytorch project changes these urls frequently, so we need to pin them to ensure that the correct version
   * is installed, else you can end up with CPU torch on a GPU machine or vice versa.
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

/**
 * Fetch the python version and PyTorch version pins required to install the target version.
 *
 * The pins are fetched from the GitHub repo.
 *
 * Note: Prior to Invoke v5.10.0, (e.g. v5.9.1 and earlier), we hardcoded the python version and
 * PyTorch indices in this launcher repo. This was problematic, because it meant we needed to
 * update the launcher whenever the app's PyTorch dependency or target python version changed.
 *
 * @param targetVersion - The version of the invokeai package
 * @returns The python version and torch index urls
 * @throws If no pins are found for the given version
 */
export const getPins = async (targetVersion: string): Promise<Pins> => {
  const tag = targetVersion.startsWith('v') ? targetVersion : `v${targetVersion}`;

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
