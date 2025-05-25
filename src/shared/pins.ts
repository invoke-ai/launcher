import { compare } from '@renovatebot/pep440';
import { assert, objectKeys } from 'tsafe';
import { z } from 'zod';

import { withResultAsync } from '@/lib/result';

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

const PACKAGE_PINS: Record<string, Pins> = {
  '5.12.0': {
    python: '3.12',
    // Indices for pytorch 2.7.0
    torchIndexUrl: {
      win32: { cuda: 'https://download.pytorch.org/whl/cu128' },
      linux: {
        cpu: 'https://download.pytorch.org/whl/cpu',
        rocm: 'https://download.pytorch.org/whl/rocm6.3',
        cuda: 'https://download.pytorch.org/whl/cu128'
      },
      darwin: {}
    }
  },
  '5.0.0': {
    python: '3.11',
    // Indices for pytorch 2.4.1
    torchIndexUrl: {
      win32: {
        cuda: 'https://download.pytorch.org/whl/cu124',
      },
      linux: {
        cpu: 'https://download.pytorch.org/whl/cpu',
        rocm: 'https://download.pytorch.org/whl/rocm6.1',
      },
      darwin: {},
    },
  },
  // This fallback 0.0.0 version represents pins for all versions of invoke from initial release to v5.0.0. Throughout
  // this period, we used many versions of torch. That means the below indices are not correct! However, because the
  // launcher was released after v5.0.0, this should not be a problem.
  //
  // TODO(psyche): I'm not sure why these pins are even necessary given that the launcher does not support installing
  // invokeai versions prior to v5.0.0. I think this is a mistake and we should remove this entry.
  '0.0.0': {
    python: '3.11',
    torchIndexUrl: {
      win32: {
        cuda: 'https://download.pytorch.org/whl/cu124',
      },
      linux: {
        cpu: 'https://download.pytorch.org/whl/cpu',
        rocm: 'https://download.pytorch.org/whl/rocm5.2',
      },
      darwin: {},
    },
  },
};

/**
 * Get python versions and torch index urls for a given version of the invokeai package.
 *
 * The pins are categorized by the first version that they are valid for. For example, if the pins are valid for
 * versions 5.0.0 and above, they will be stored under the key '5.0.0'.
 *
 * The highest pin version that is less than or equal to the target version is selected. For example, if the target
 * version is 5.5.0, the 5.0.0 pins will be returned.
 *
 * @param targetVersion - The version of the invokeai package
 * @returns The python version and torch index urls
 * @throws If no pins are found for the given version
 */
export const getPins = async (targetVersion: string): Promise<Pins> => {
  // Fetch `pins.json` from the repo using the targetVersion as the tag
  const tag = targetVersion.startsWith('v') ? targetVersion : `v${targetVersion}`;
  for (const url of [
    `https://raw.githubusercontent.com/invoke-ai/InvokeAI/${tag}/pins.json`,
    `https://fastly.jsdelivr.net/gh/invoke-ai/InvokeAI@${tag}/pins.json`
  ]) {
    console.log('Fetching pins from', url);
    const result = await withResultAsync(async () => {
      const res = await fetch(url);
      assert(res.ok, `Failed to fetch pins.json from ${url}`);
      const json = await res.json();
      const pins = zPins.parse(json);
      return pins;
    });
  
    if (result.isOk()) {
      console.log('Fetched pins:', result.value);
      return result.value;
    }

    console.log('Failed to fetch pins:', result.error);
  }

  // If the fetch fails, fall back to the hardcoded pins
  console.log('Falling back to hardcoded pins');
  const versions = objectKeys(PACKAGE_PINS);
  const sortedVersions = versions.sort(compare).toReversed();
  const pinKey = sortedVersions.find((version) => compare(version, targetVersion) <= 0);
  assert(pinKey !== undefined, `No pins found for version ${targetVersion}`);
  const pins = PACKAGE_PINS[pinKey];
  assert(pins !== undefined, `No pins found for version ${targetVersion}`);
  return pins;
};
