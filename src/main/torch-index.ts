import type { LockedPackage } from '@/shared/pins';
import { splitIndexUrlCredentials } from '@/shared/url';

/**
 * Builds the `uv pip install` invocation that installs the torch-family packages from a user-provided index.
 *
 * Extracted from the install manager so the argv construction - where the interesting failure modes live - is directly
 * testable without spawning a PTY.
 */

/** The name we register the user's custom index under. uv derives its credential env vars from this name. */
export const CUSTOM_TORCH_INDEX_NAME = 'invoke-custom-torch';

/** `UV_INDEX_<NAME>_USERNAME` / `_PASSWORD`, where `<NAME>` is the index name uppercased with `-` replaced by `_`. */
const CUSTOM_TORCH_INDEX_ENV_PREFIX = `UV_INDEX_${CUSTOM_TORCH_INDEX_NAME.toUpperCase().replaceAll('-', '_')}`;

type CustomTorchInstallCommand = {
  args: string[];
  /** Extra environment for the command. Carries index credentials, which must never appear in argv. */
  env: Record<string, string>;
};

export const buildCustomTorchInstallCommand = (
  venvPath: string,
  indexUrl: string,
  packages: LockedPackage[]
): CustomTorchInstallCommand => {
  // Credentials go in the environment, not in argv, which is world-readable for the life of a multi-GB download.
  const { url, username, password } = splitIndexUrlCredentials(indexUrl);

  const args = [
    'pip',
    'install',
    '--python',
    venvPath,
    '--python-preference',
    'only-managed',
    // Register the custom index *in addition to* PyPI rather than replacing it (`--index-url`/`--default-index`).
    //
    // uv's default index strategy is `first-index`: for a given package name it only considers versions from the first
    // index that carries that name at all. So the torch family resolves solely from the custom index - if the pinned
    // (tag-stripped) version is missing there, uv fails with "No solution found ... but not at the requested version"
    // rather than silently substituting the PyPI wheel. (Verified against the bundled uv; `--index-url` behaves
    // identically here, and is deprecated in favour of `--default-index`.)
    //
    // The difference that matters is everything torch *depends on*: on Linux, torch's CUDA runtime (`nvidia-*-cu12`,
    // `triton`) is resolved from PyPI and pinned exactly by the torch wheel's metadata. Those must come from PyPI at
    // the versions the custom build wants, otherwise we would leave e.g. a cu126 torch running against the lock's
    // cu128 cuBLAS/cuDNN.
    `--index=${CUSTOM_TORCH_INDEX_NAME}=${url}`,
    // Be explicit rather than relying on the default: an ambient `UV_INDEX_STRATEGY=unsafe-best-match` (or a user
    // `uv.toml`) would otherwise re-enable the silent PyPI fallback this whole step exists to avoid.
    '--index-strategy',
    'first-index',
    '--compile-bytecode',
  ];

  // The torch packages were skipped during `uv sync`, but on a reinstall/update an older build may still be present.
  // Force *only* those to be reinstalled - a blanket `--force-reinstall` would also rebuild every dependency uv
  // resolves here, which is a large and pointless download.
  for (const { name } of packages) {
    args.push('--reinstall-package', name);
  }

  for (const { name, version } of packages) {
    args.push(`${name}==${version}`);
  }

  const env: Record<string, string> = {};
  if (username !== undefined) {
    env[`${CUSTOM_TORCH_INDEX_ENV_PREFIX}_USERNAME`] = username;
  }
  if (password !== undefined) {
    env[`${CUSTOM_TORCH_INDEX_ENV_PREFIX}_PASSWORD`] = password;
  }

  return { args, env };
};
