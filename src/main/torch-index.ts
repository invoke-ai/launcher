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

type CustomIndexArg = {
  /** The `--index=<name>=<url>` argument, with any userinfo stripped out of the URL. */
  arg: string;
  /** Credential environment for that index, empty when the URL carried none. */
  env: Record<string, string>;
};

/**
 * Register a user-provided index with uv under {@link CUSTOM_TORCH_INDEX_NAME}, passing any credentials through the
 * environment rather than argv - the command line is world-readable (`ps auxww`, `/proc/<pid>/cmdline`, Task Manager)
 * for the life of a multi-GB download.
 *
 * Shared by both install paths so neither can forget it.
 */
const buildCredentialEnv = (username?: string, password?: string): Record<string, string> => {
  const env: Record<string, string> = {};
  if (username !== undefined) {
    env[`${CUSTOM_TORCH_INDEX_ENV_PREFIX}_USERNAME`] = username;
  }
  if (password !== undefined) {
    env[`${CUSTOM_TORCH_INDEX_ENV_PREFIX}_PASSWORD`] = password;
  }
  return env;
};

export const buildCustomIndexArg = (indexUrl: string): CustomIndexArg => {
  const { url, username, password } = splitIndexUrlCredentials(indexUrl);
  return { arg: `--index=${CUSTOM_TORCH_INDEX_NAME}=${url}`, env: buildCredentialEnv(username, password) };
};

type CustomIndexProbeCommand = {
  args: string[];
  /** Extra environment for the command. Carries index credentials, which must never appear in argv. */
  env: Record<string, string>;
};

/**
 * Build a resolution-only `uv pip install --dry-run` that asks whether the custom index can satisfy the torch
 * requirements, before anything is downloaded.
 *
 * The point is the `--default-index`: it makes the override the *only* index for this one command. Merely registering
 * it alongside the others - which is what the real install has to do, so that torch's CUDA runtime can still come from
 * PyPI - lets uv skip an index that rejects a request and resolve from the next one instead, silently and with exit
 * code 0. Measured against the bundled uv 0.11.28 and a one-character typo of a real index (`whl/cu1266`, which
 * answers 403): registered alongside PyPI it installs the PyPI `torch==2.7.1`, and alongside a pinned index it
 * installs that index's `+cu128` build. With no other index to fall back to, the same URL is a loud resolution error.
 *
 * Asking uv rather than fetching the project page ourselves also means the check inherits everything uv knows about
 * reaching an index: `.netrc` and system-keyring credentials, and the proxy configuration. A private index that
 * answers 403 or 401 to anonymous requests but authenticates for uv resolves here exactly as it will during the
 * install, instead of being reported as an index that does not carry torch.
 */
export const buildCustomIndexProbeCommand = (
  pythonTarget: string,
  indexUrl: string,
  requirements: string[]
): CustomIndexProbeCommand => {
  const { url, username, password } = splitIndexUrlCredentials(indexUrl);

  return {
    args: [
      'pip',
      'install',
      '--python',
      pythonTarget,
      '--python-preference',
      'only-managed',
      `--default-index=${CUSTOM_TORCH_INDEX_NAME}=${url}`,
      // Without this the probe is a rubber stamp for anyone with a `uv.toml`: an `[[index]]` declared in config
      // outranks `--default-index` (measured - `UV_INDEX_URL` does not, only the config file), so that index answers
      // for torch and the typo'd URL resolves happily. Config is the only ambient source that has to go; `.netrc`,
      // the proxy environment and `SSL_CERT_FILE` are unaffected, so a private index still authenticates here exactly
      // as it will during the install.
      '--no-config',
      // Resolve and report; touch nothing.
      '--dry-run',
      // Dependencies are the real install's business, and they come from PyPI - not from this index.
      '--no-deps',
      ...requirements,
    ],
    env: buildCredentialEnv(username, password),
  };
};

export const buildCustomTorchInstallCommand = (
  venvPath: string,
  indexUrl: string,
  packages: LockedPackage[]
): CustomTorchInstallCommand => {
  const { arg: indexArg, env } = buildCustomIndexArg(indexUrl);

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
    indexArg,
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

  return { args, env };
};
