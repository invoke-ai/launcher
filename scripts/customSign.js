/* eslint-disable  @typescript-eslint/no-require-imports */

const ossign = require('@ossign/ossign');

const signedFilePaths = new Set();

/**
 * Every executable we ship must be signed, not just the ones with "Invoke" in the name.
 * Windows Smart App Control refuses to CreateProcess an unsigned binary, which is how
 * https://github.com/invoke-ai/launcher/issues/148 happened: the installer was signed but the
 * `winpty-agent.exe` that node-pty spawns was not, so the launcher died on startup.
 *
 * electron-builder offers us far more files than we want to sign, so this is an allowlist.
 * `signExts` in electron-builder.config.ts controls which extensions get offered at all
 * (`.exe` always, plus `.dll` and `.node`); this classifier decides what happens to each one.
 */

/** @typedef {'sign' | 'skip-already-signed' | 'skip-out-of-scope' | 'unknown'} BinaryClass */

/**
 * Paths we sign. Matched against the path with `\` normalized to `/`.
 *
 * Example paths, as seen in CI logs:
 * - NSIS installer:   `D:\a\launcher\launcher\dist\Invoke Community Edition Setup 1.7.0-alpha.10.exe`
 * - NSIS uninstaller: `D:\a\launcher\launcher\dist\__uninstaller-nsis-invoke-community-edition.exe`
 * - Main executable:  `D:\a\launcher\launcher\dist\win-unpacked\Invoke Community Edition.exe`
 * - winpty agent:     `...\win-unpacked\resources\app.asar.unpacked\node_modules\node-pty\build\Release\winpty-agent.exe`
 * - uv:               `...\win-unpacked\resources\bin\uv.exe`
 */
const SIGN_PATTERNS = [
  // Our own artifacts: installer, uninstaller and the main app executable. The `[^/]*` keeps the
  // match inside a single path segment, so a directory that happens to be named after the product
  // cannot drag unrelated executables in with it.
  /[iI]nvoke[\s-][cC]ommunity[\s-][eE]dition[^/]*\.exe$/,
  // node-pty's own native output, in both the locations it uses: `build/Release` (node-gyp output,
  // which on Windows is winpty-agent.exe, winpty.dll, pty.node, conpty.node and
  // conpty_console_list.node) and `bin/<platform>-<arch>-<abi>` (its prebuild layout). node-gyp
  // compiles these from deps/winpty at install time so nobody upstream has signed them.
  // winpty-agent.exe is the one Smart App Control actually blocks — node-pty spawns it as a child
  // process — but the rest ship beside it and cost nothing to sign.
  // This deliberately recurses (`.*` rather than `[^/]+`) so that a subdirectory node-pty adds
  // later is signed by default rather than silently shipping unsigned. That makes the ordering in
  // classifyBinary() load-bearing: it also reaches `build/Release/conpty`, which
  // ALREADY_SIGNED_PATTERNS has to claim first.
  /\/node_modules\/node-pty\/(build\/Release|bin\/[^/]+)\/.*\.(exe|dll|node)$/,
  // The uv binary we bundle via extraResources. Astral does not sign their Windows builds, and the
  // launcher spawns uv as a child process, so Smart App Control would block it next.
  // Case-sensitive on purpose: electron-builder's own shouldSignFile() is case-sensitive, so a
  // case-insensitive rule here could claim a file that never actually reaches this hook.
  // download_uv.ts only ever copies uv/uv.exe; uvx is matched pre-emptively and does not ship yet.
  /\/bin\/uvx?\.exe$/,
  // electron-builder's NSIS elevation helper. It is copied into resources/ by the NSIS target
  // (app-builder-lib/out/targets/nsis/nsisUtil.js, CopyElevateHelper) and ships completely
  // unsigned — and electron-updater spawns it from process.resourcesPath when an update needs
  // admin rights, so Smart App Control gates it exactly like winpty-agent.exe.
  /\/resources\/elevate\.exe$/,
];

/**
 * Paths that arrive already signed by someone else. Re-signing would replace a Microsoft
 * signature with ours for no benefit, so we leave them alone.
 *
 * `expectedSigner` is the string checkWindowsSigningCoverage.js requires to appear in the file's
 * embedded certificate, so "somebody else already signed this" is verified rather than trusted.
 *
 * @type {{ pattern: RegExp, expectedSigner: string }[]}
 */
const ALREADY_SIGNED_PATTERNS = [
  // node-pty redistributes Microsoft's ConPTY binaries verbatim: OpenConsole.exe (which node-pty
  // does spawn, so it matters) and conpty.dll. Both carry a timestamped Microsoft Code Signing
  // PCA 2011 signature.
  //
  // Two locations, and both must be listed: `third_party/conpty/<ver>/win10-<arch>` is the stash
  // shipped in the npm tarball, and node-pty's scripts/post-install.js copies the pair for the
  // current arch into `build/Release/conpty` on Windows — that copy is the one loaded at runtime,
  // and it sits inside the build output directory that SIGN_PATTERNS otherwise claims.
  { pattern: /\/node_modules\/node-pty\/third_party\/conpty\//, expectedSigner: 'Microsoft Corporation' },
  { pattern: /\/node_modules\/node-pty\/build\/Release\/conpty\//, expectedSigner: 'Microsoft Corporation' },
];

/**
 * Paths we knowingly ship unsigned. These are Electron's own runtime DLLs, which upstream does not
 * sign either. They are loaded in-process rather than spawned, so Smart App Control does not gate
 * them, and signing them would mean vouching for Chromium bits we do not build.
 */
const OUT_OF_SCOPE_PATTERNS = [/\/(ffmpeg|libEGL|libGLESv2|vk_swiftshader|vulkan-1|d3dcompiler_47)\.dll$/i];

/**
 * Decide what to do with a binary electron-builder handed us.
 *
 * Anything that falls through to `unknown` is skipped (we would rather ship an unsigned file than
 * break a release), but scripts/checkWindowsSigningCoverage.js fails CI on it so the gap gets
 * noticed at PR time instead of after a release.
 *
 * @param {string} filePath
 * @returns {BinaryClass}
 */
function classifyBinary(filePath) {
  const normalized = filePath.replace(/\\/g, '/');

  if (expectedSignerFor(filePath) !== null) {
    return 'skip-already-signed';
  }
  if (SIGN_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return 'sign';
  }
  if (OUT_OF_SCOPE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return 'skip-out-of-scope';
  }
  return 'unknown';
}

/**
 * The signer we expect to already own this binary, or null if we do not claim it is pre-signed.
 *
 * @param {string} filePath
 * @returns {string | null}
 */
function expectedSignerFor(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  const match = ALREADY_SIGNED_PATTERNS.find((entry) => entry.pattern.test(normalized));
  return match ? match.expectedSigner : null;
}

/**
 * Custom signing script for OSSign integration with electron-builder.
 *
 * The @ossign/ossign package downloads the ossign CLI on first use and shells out to it.
 * The CLI reads its signing config from the OSSIGN_CONFIG or OSSIGN_CONFIG_BASE64
 * environment variable, which must be set in the calling environment.
 *
 * @param {import('app-builder-lib').CustomWindowsSignTaskConfiguration} configuration
 * @returns {void}
 */
function sign(configuration) {
  const { path: filePath } = configuration;

  if (signedFilePaths.has(filePath)) {
    console.log(`Skipping already signed binary: ${filePath}`);
    return;
  }

  const classification = classifyBinary(filePath);
  if (classification !== 'sign') {
    console.log(`Skipping signing for binary (${classification}): ${filePath}`);
    return;
  }

  if (!process.env.OSSIGN_CONFIG && !process.env.OSSIGN_CONFIG_BASE64) {
    throw new Error('OSSIGN_CONFIG or OSSIGN_CONFIG_BASE64 environment variable must be set to sign binaries.');
  }

  console.log(`Signing ${filePath} with OSSign...`);
  ossign.SignSync(filePath, filePath, 'pecoff');
  signedFilePaths.add(filePath);
  console.log(`Signed ${filePath}`);
}

// SIGN_PATTERNS is exported so the test can prove the overlap with ALREADY_SIGNED_PATTERNS is real
// and that classifyBinary's ordering is what resolves it.
module.exports = { sign, classifyBinary, expectedSignerFor, SIGN_PATTERNS };
