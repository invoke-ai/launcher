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

/** uv reads an index's credentials from env vars named after the index, which keeps them out of argv. */
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

/**
 * Register a user-provided index with uv under {@link CUSTOM_TORCH_INDEX_NAME}, passing any credentials through the
 * environment rather than argv - the command line is world-readable (`ps auxww`, `/proc/<pid>/cmdline`, Task Manager)
 * for the life of a multi-GB download.
 *
 * Shared by both install paths so neither can forget it.
 */
export const buildCustomIndexArg = (indexUrl: string): CustomIndexArg => {
  const { url, username, password } = splitIndexUrlCredentials(indexUrl);
  return { arg: `--index=${CUSTOM_TORCH_INDEX_NAME}=${url}`, env: buildCredentialEnv(username, password) };
};

type CustomIndexProbeCommand = {
  args: string[];
  /** The complete environment for the command - not overrides. Ambient index settings are neutralized in it. */
  env: Record<string, string>;
};

/**
 * uv environment variables that add or replace indexes.
 *
 * `--no-config` closes the config-file route into the probe, but not these. `UV_INDEX`, `UV_EXTRA_INDEX_URL` and
 * `UV_FIND_LINKS` all add a source that outranks or augments `--default-index`, so any one of them turns the probe
 * into a rubber stamp: with `UV_INDEX` exported from a shell profile, a typo'd custom index resolves from *that* and
 * the probe passes. `UV_DEFAULT_INDEX` and `UV_INDEX_URL` are correctly overridden by the flag, but they are removed
 * too - the probe should depend on exactly one index, and not on which slot a variable happens to occupy.
 *
 * The install manager builds its environment from the user's login shell, so these genuinely reach uv.
 *
 * They are set to the empty string rather than deleted. The env we return is merged over `process.env` when the
 * command is spawned (`createPtyProcess`: `{ ...process.env, ...DEFAULT_ENV, ...options.env }`), so deleting a key
 * only removes it if it arrived via `shellEnvSync()` and is absent from the launcher's own environment - which is the
 * exception, not the rule: a Windows user-level variable, a Linux session variable, or any launch from a terminal all
 * put it in `process.env`, where a deletion cannot reach it. An empty value can, and uv reads these as unset
 * (measured against the bundled 0.11.28: with each of the three set to `''`, a typo'd index is rejected as it should
 * be, and a real one still resolves).
 */
const AMBIENT_INDEX_ENV_VARS = ['UV_INDEX', 'UV_EXTRA_INDEX_URL', 'UV_FIND_LINKS', 'UV_DEFAULT_INDEX', 'UV_INDEX_URL'];

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
 *
 * `useUvConfig` exists for the second attempt the install manager makes when the isolated probe fails: uv config can
 * carry credentials for the index under test, not just substitute indexes, so a failure with config suppressed is not
 * yet proof that the index is wrong.
 */
export const buildCustomIndexProbeCommand = (arg: {
  pythonTarget: string;
  indexUrl: string;
  requirements: string[];
  /** The environment the real install would use. Returned with the ambient index settings neutralized. */
  baseEnv: Record<string, string>;
  useUvConfig?: boolean;
}): CustomIndexProbeCommand => {
  const { url, username, password } = splitIndexUrlCredentials(arg.indexUrl);

  const env = { ...arg.baseEnv, ...buildCredentialEnv(username, password) };
  for (const name of AMBIENT_INDEX_ENV_VARS) {
    env[name] = '';
  }

  return {
    args: [
      'pip',
      'install',
      '--python',
      arg.pythonTarget,
      '--python-preference',
      'only-managed',
      `--default-index=${CUSTOM_TORCH_INDEX_NAME}=${url}`,
      // An `[[index]]` declared in a `uv.toml` outranks `--default-index` (measured), so that index would answer for
      // torch and the typo'd URL would resolve happily. Config also carries credentials, `keyring-provider` and TLS
      // settings the real install honours, which is why the caller retries with config once this attempt fails.
      ...(arg.useUvConfig ? [] : ['--no-config']),
      // Resolve and report; touch nothing.
      '--dry-run',
      // Dependencies are the real install's business, and they come from PyPI - not from this index.
      '--no-deps',
      ...arg.requirements,
    ],
    env,
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
