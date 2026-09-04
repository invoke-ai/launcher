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
export const buildCustomIndexArg = (indexUrl: string): CustomIndexArg => {
  const { url, username, password } = splitIndexUrlCredentials(indexUrl);

  const env: Record<string, string> = {};
  if (username !== undefined) {
    env[`${CUSTOM_TORCH_INDEX_ENV_PREFIX}_USERNAME`] = username;
  }
  if (password !== undefined) {
    env[`${CUSTOM_TORCH_INDEX_ENV_PREFIX}_PASSWORD`] = password;
  }

  return { arg: `--index=${CUSTOM_TORCH_INDEX_NAME}=${url}`, env };
};

/** PEP 503 normalized project name - the path a simple index serves a package under. */
const normalizePackageName = (name: string): string => name.toLowerCase().replace(/[-_.]+/g, '-');

type IndexPackageCheck = {
  name: string;
  /**
   * - `served` - the index answered 2xx.
   * - `not-served` - the index answered that it does not have this project. This is the only verdict worth blocking
   *   on, because it is the one uv reads as "not published here" and quietly resolves from PyPI instead.
   * - `unknown` - we did not get an answer we are entitled to act on.
   */
  verdict: 'served' | 'not-served' | 'unknown';
  detail: string;
};

/**
 * Statuses that mean "this index does not carry that project", as opposed to "you did not ask correctly".
 *
 * Deliberately narrow. This check sees less than uv does: it knows only about credentials embedded in the URL, while
 * uv also reads `.netrc` and the system keyring, and it goes through Node's `fetch`, which ignores the `HTTP(S)_PROXY`
 * variables uv honours. So a 401 or a 407 says nothing about whether the package is there - only that *we* could not
 * see it - and blocking on those would lock every `.netrc` and behind-a-proxy user out of the feature with an error
 * message that is simply false. Anything uncertain degrades to a warning; uv is loud about all of it anyway.
 */
const NOT_SERVED_STATUSES = new Set([403, 404, 410]);

/**
 * Ask the custom index whether it actually serves each package, before anything is downloaded.
 *
 * `--index-strategy first-index` pins resolution to the custom index only for package *names* that index carries. When
 * it answers 404 or 403 for a project - a typo in the path, a mirror that proxies only part of PyPI - uv reads that as
 * "not published here", falls through to PyPI and installs the default build. Exit code 0, no warning, and the user is
 * told the install succeeded from their index while the venv holds the PyPI wheel.
 *
 * The other failure modes are already loud (connection refused, and an index that has the name but not the pinned
 * version both abort the install), so this closes the last silent path.
 */
export const checkIndexServesPackages = async (
  indexUrl: string,
  packageNames: string[]
): Promise<IndexPackageCheck[]> => {
  const { url, username, password } = splitIndexUrlCredentials(indexUrl);

  const headers: Record<string, string> = {};
  if (username !== undefined || password !== undefined) {
    const basic = Buffer.from(`${username ?? ''}:${password ?? ''}`).toString('base64');
    headers.Authorization = `Basic ${basic}`;
  }

  return await Promise.all(
    packageNames.map(async (name): Promise<IndexPackageCheck> => {
      // Extend the *path*, keeping any query or fragment. Resolving `torch/` as a relative URL would drop a
      // `?token=…` the index needs, and appending a slash to the whole URL would put it after the query string.
      const projectUrl = new URL(url);
      const basePath = projectUrl.pathname.endsWith('/') ? projectUrl.pathname : `${projectUrl.pathname}/`;
      projectUrl.pathname = `${basePath}${normalizePackageName(name)}/`;

      try {
        const response = await fetch(projectUrl.toString(), { headers, signal: AbortSignal.timeout(15000) });
        if (response.ok) {
          return { name, verdict: 'served', detail: `HTTP ${response.status}` };
        }
        return {
          name,
          verdict: NOT_SERVED_STATUSES.has(response.status) ? 'not-served' : 'unknown',
          detail: `HTTP ${response.status}`,
        };
      } catch (error) {
        return {
          name,
          verdict: 'unknown',
          detail: `could not reach the index (${error instanceof Error ? error.message : String(error)})`,
        };
      }
    })
  );
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
