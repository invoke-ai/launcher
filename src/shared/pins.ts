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
  pins: Pins;
  pyprojectToml: string;
  uvLock: string;
};

type LockedPackage = { name: string; version: string };

type TorchPlatform = 'cuda' | 'rocm' | 'cpu';

/**
 * Matches a package's own top-level `source` against the PyTorch download index for the given torch platform. Invoke's
 * lockfile contains a torch build for every platform (e.g. `.../whl/cu128`, `.../whl/rocm7.1`, `.../whl/cpu`); we only
 * want the packages for the platform the user is actually installing. The exact suffix (cu128 vs cu126) is what the
 * custom index overrides, so we match the platform category, not the exact URL.
 *
 * The pattern is anchored to the start of a line (`^` with the `m` flag) so it matches the package's own `source = {…}`
 * line and NOT the `source = {…}` nested inside other packages' `dependencies = [ { name = "torch", …, source = {…} } ]`
 * inline tables (which are indented) - otherwise every package that depends on torch would match.
 */
const TORCH_INDEX_SOURCE_PATTERN: Record<TorchPlatform, RegExp> = {
  cuda: /^source\s*=\s*\{[^}]*download\.pytorch\.org\/whl\/cu\d+[^}]*\}/m,
  rocm: /^source\s*=\s*\{[^}]*download\.pytorch\.org\/whl\/rocm[^}]*\}/m,
  cpu: /^source\s*=\s*\{[^}]*download\.pytorch\.org\/whl\/cpu[^}]*\}/m,
};

/**
 * Parse the torch-family packages for a given torch platform out of an Invoke release's `uv.lock`.
 *
 * We select every `[[package]]` block whose `source` points at the PyTorch download index for `torchPlatform` (e.g.
 * for `cuda`, `https://download.pytorch.org/whl/cu128`). These are exactly the packages a custom torch index would
 * replace - and we deliberately ignore the other platforms' torch builds, which carry different versions and would
 * otherwise conflict.
 *
 * The local version tag (e.g. `+cu128`) is stripped so the returned `==<version>` pin matches the equivalent build on
 * a different index (e.g. `2.7.1` matches `2.7.1+cu126`). Regex-based on purpose to avoid pulling in a TOML parser
 * dependency, mirroring `getDeclaredOptionalDependencies` in the install manager.
 */
export const getTorchPackagesFromLock = (uvLock: string, torchPlatform: TorchPlatform): LockedPackage[] => {
  const sourcePattern = TORCH_INDEX_SOURCE_PATTERN[torchPlatform];
  const packages: LockedPackage[] = [];

  // Split into individual `[[package]]` blocks. The first chunk (before the first `[[package]]`) is dropped.
  for (const block of uvLock.split(/\n\[\[package\]\]/).slice(1)) {
    // Only consider packages resolved from the PyTorch download index for the selected platform.
    if (!sourcePattern.test(block)) {
      continue;
    }

    const name = block.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
    const version = block.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
    if (!name || !version) {
      continue;
    }

    // Strip the local version tag (e.g. `2.7.1+cu128` -> `2.7.1`) so the pin resolves against a different index.
    packages.push({ name, version: version.split('+')[0]! });
  }

  return packages;
};

const getInvokeReleaseTag = (targetVersion: string): string => {
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
  return zPins.parse(JSON.parse(await fetchInvokeReleaseFile(tag, 'pins.json')));
};

export const getInvokeReleaseInstallFiles = async (targetVersion: string): Promise<InvokeReleaseInstallFiles> => {
  const tag = getInvokeReleaseTag(targetVersion);
  const [pinsJson, pyprojectToml, uvLock] = await Promise.all([
    fetchInvokeReleaseFile(tag, 'pins.json'),
    fetchInvokeReleaseFile(tag, 'pyproject.toml'),
    fetchInvokeReleaseFile(tag, 'uv.lock'),
  ]);

  return {
    pins: zPins.parse(JSON.parse(pinsJson)),
    pyprojectToml,
    uvLock,
  };
};
