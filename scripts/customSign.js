/* eslint-disable  @typescript-eslint/no-require-imports */

const fs = require('fs');
const path = require('path');

const ossign = require('@ossign/ossign');

const { inspectSignature } = require('./authenticode.js');

const signedFilePaths = new Set();

/**
 * Which bundled binaries we sign.
 *
 * The policy is **sign everything we ship, except binaries that already carry a working signature
 * from somebody else**. It used to be an allowlist keyed on our own product name, and that is how
 * https://github.com/invoke-ai/launcher/issues/148 happened: Windows Smart App Control refuses to
 * CreateProcess an unsigned binary, our installer was signed, and the `winpty-agent.exe` that
 * node-pty spawns was not, so the launcher died on startup.
 *
 * Defaulting to "sign" rather than "skip" is the point. Under an allowlist, a binary that a future
 * dependency adds ships unsigned and nothing says a word; the failure only shows up on an end
 * user's machine with Smart App Control on.
 *
 * We do not reason about which binaries Windows gates and which it does not — an earlier version of
 * this file claimed in-process DLL loads were exempt while simultaneously signing node-pty's DLLs,
 * which was incoherent. Signing everything costs a few seconds per build and removes the question.
 *
 * The one thing we must never do is sign *over* somebody else's signature. Microsoft's certificate
 * carries Smart App Control reputation that a newer identity does not, so replacing it would make
 * things worse. That check is made against the file itself rather than against a path list —
 * `d3dcompiler_47.dll` ships Microsoft-signed inside Electron and a path list had already missed it
 * once. EXEMPTIONS below is the *declaration* of the cases we know about;
 * scripts/checkWindowsSigningCoverage.js fails if a binary shows up pre-signed without one.
 */

/** @typedef {'sign' | 'skip-already-signed' | 'skip-unreadable-signature'} BinaryClass */

/**
 * Binaries we expect to arrive already signed, and by whom.
 *
 * This list does not control signing — `sign()` skips anything that already carries an intact
 * signature, declared or not, because stripping one is never the safe move. It exists so that a
 * *new* pre-signed binary appearing in the package is surfaced in CI and consciously acknowledged
 * rather than silently trusted.
 *
 * @type {{ pattern: RegExp, expectedSigner: string, reason: string }[]}
 */
const EXEMPTIONS = [
  {
    // node-pty redistributes Microsoft's ConPTY binaries verbatim: OpenConsole.exe (which node-pty
    // spawns, so it is squarely in Smart App Control's path) and conpty.dll. `third_party/conpty`
    // is what ships; node-pty's post-install also copies the current arch's pair into
    // `build/Release/conpty` on Windows, which our own postinstall normally wipes.
    pattern: /\/node_modules\/node-pty\/(third_party|build\/Release)\/conpty\//,
    expectedSigner: 'Microsoft Corporation',
    reason: "Microsoft's ConPTY binaries, redistributed verbatim by node-pty",
  },
  {
    // Electron bundles Microsoft's D3DCompiler redistributable, already signed by Microsoft. The
    // other five DLLs Electron ships at the package root (ffmpeg, libEGL, libGLESv2,
    // vk_swiftshader, vulkan-1) are unsigned and we sign those ourselves.
    pattern: /\/d3dcompiler_47\.dll$/i,
    expectedSigner: 'Microsoft Corporation',
    reason: "Microsoft's D3DCompiler redistributable, bundled by Electron",
  },
];

/**
 * The declared exemption covering this path, or null.
 *
 * @param {string} filePath
 * @returns {{ pattern: RegExp, expectedSigner: string, reason: string } | null}
 */
function exemptionFor(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  return EXEMPTIONS.find((exemption) => exemption.pattern.test(normalized)) ?? null;
}

/**
 * Decide what happens to a binary electron-builder handed us.
 *
 * Decided by the file's own contents, not its path: a binary that already carries an intact
 * signature is left alone whether or not anyone declared it.
 *
 * @param {string} filePath
 * @returns {BinaryClass}
 */
function classifyBinary(filePath) {
  switch (inspectSignature(filePath).state) {
    case 'intact':
      return 'skip-already-signed';
    case 'unreadable':
      // Not "bad signature" — "signature we could not read". Replacing it might destroy a working
      // one, so we leave it and let CI complain instead.
      return 'skip-unreadable-signature';
    default:
      return 'sign';
  }
}

/**
 * Custom signing script for OSSign integration with electron-builder.
 *
 * The @ossign/ossign package downloads the ossign CLI on first use and shells out to it.
 * The CLI reads its signing config from the OSSIGN_CONFIG or OSSIGN_CONFIG_BASE64
 * environment variable, which must be set in the calling environment.
 *
 * Set SIGNING_DRY_RUN to a file path to record which binaries electron-builder offers without
 * signing any of them. That record is what proves reachability: it is the only way to know a file
 * was actually handed to this hook, rather than assumed to have been. See
 * scripts/checkWindowsSigningCoverage.js.
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

  const dryRunRecord = process.env.SIGNING_DRY_RUN;
  // Definedness, not truthiness: @ossign/ossign gates on `!== undefined`, and the CLI honours a
  // defined-but-empty OSSIGN_CONFIG. Using truthiness here would let `OSSIGN_CONFIG=""` slip past
  // the guard below and produce exactly the silent unsigned build it exists to prevent.
  const hasSigningConfig = process.env.OSSIGN_CONFIG !== undefined || process.env.OSSIGN_CONFIG_BASE64 !== undefined;

  // A dry run signs nothing. If a signing config is also present then somebody meant to produce a
  // real, signed build, and honouring the dry run would ship every binary unsigned with no error,
  // no failing exit code and no CI signal — strictly worse than #148, which was one file. Note that
  // `npm run package` loads .env into the environment, so this variable has a way of arriving
  // without anyone intending it. Refuse the contradiction rather than guessing which one wins.
  if (dryRunRecord && hasSigningConfig) {
    throw new Error(
      'SIGNING_DRY_RUN is set together with OSSIGN_CONFIG/OSSIGN_CONFIG_BASE64. A dry run does not ' +
        'sign anything, so continuing would silently produce an unsigned build. Unset SIGNING_DRY_RUN ' +
        'to sign for real, or unset the signing config to record what would be signed.'
    );
  }

  if (dryRunRecord) {
    // Append only. Truncating here would look tidier, but several electron-builder processes can
    // share one record, and whichever started last would wipe the others' entries — turning a
    // stale record (which can only ever mask a regression) into a spurious "never offered"
    // failure. Starting from a clean record is the caller's job; build.yml deletes it first.
    fs.mkdirSync(path.dirname(dryRunRecord), { recursive: true });
    fs.appendFileSync(dryRunRecord, `${filePath}\n`);
    console.log(`[dry run] offered for signing: ${filePath}`);
    return;
  }

  // Never sign over an intact third-party signature — see the note above EXEMPTIONS.
  const signature = inspectSignature(filePath);
  if (signature.state === 'intact') {
    const exemption = exemptionFor(filePath);
    const provenance = exemption ? exemption.reason : 'UNDECLARED — add it to EXEMPTIONS';
    console.log(`Skipping ${filePath} — already signed (${provenance})`);
    return;
  }
  if (signature.state === 'unreadable') {
    // We could not read this signature, which is not the same as knowing it is bad — it may be
    // valid and merely beyond our parser. Replacing it would destroy a working signature, so leave
    // it alone; checkWindowsSigningCoverage.js fails the build so somebody looks.
    console.log(`Skipping ${filePath} — not signed, because ${signature.reason}`);
    return;
  }
  if (signature.state === 'broken') {
    console.log(`Signing ${filePath} despite its existing certificate: ${signature.reason}`);
  }

  if (!process.env.OSSIGN_CONFIG && !process.env.OSSIGN_CONFIG_BASE64) {
    throw new Error('OSSIGN_CONFIG or OSSIGN_CONFIG_BASE64 environment variable must be set to sign binaries.');
  }

  console.log(`Signing ${filePath} with OSSign...`);
  ossign.SignSync(filePath, filePath, 'pecoff');
  signedFilePaths.add(filePath);
  console.log(`Signed ${filePath}`);
}

module.exports = { sign, classifyBinary, exemptionFor, EXEMPTIONS };
