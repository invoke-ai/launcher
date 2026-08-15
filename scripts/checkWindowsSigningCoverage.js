/* eslint-disable  @typescript-eslint/no-require-imports */

const fs = require('fs');
const path = require('path');

const { classifyBinary, expectedSignerFor } = require('./customSign.js');

/**
 * Verifies that every Windows binary we ship is accounted for by the signing allowlist in
 * scripts/customSign.js.
 *
 * Signing itself happens on OSSign's runner, where we never see the logs, and a filter that stops
 * matching just prints "Skipping..." and ships an unsigned binary — which is exactly how
 * https://github.com/invoke-ai/launcher/issues/148 reached users. This runs against the *unsigned*
 * build produced by .github/workflows/build.yml on every PR, so a stale allowlist fails there
 * instead of in a release.
 *
 * Usage: node scripts/checkWindowsSigningCoverage.js [dist/win-unpacked]
 */

const BINARY_EXTENSIONS = new Set(['.exe', '.dll', '.node']);

/**
 * Collect every binary under `dir`.
 *
 * `Dirent.isFile()`/`isDirectory()` are false for symlinks and (on Windows) junctions, so resolve
 * those with `statSync` rather than skipping them — a symlinked binary that the walk ignored would
 * be a silent hole in the coverage guarantee. `seen` breaks symlink cycles.
 *
 * @param {string} dir
 * @param {Set<string>} [seen]
 * @returns {string[]}
 */
function walk(dir, seen = new Set()) {
  const realDir = fs.realpathSync(dir);
  if (seen.has(realDir)) {
    return [];
  }
  seen.add(realDir);

  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    let stats;
    try {
      stats = fs.statSync(entryPath);
    } catch {
      // Broken symlink: nothing ships, nothing to classify.
      continue;
    }
    if (stats.isDirectory()) {
      found.push(...walk(entryPath, seen));
    } else if (stats.isFile() && BINARY_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      found.push(entryPath);
    }
  }
  return found;
}

/**
 * Read a PE file's embedded Authenticode certificate, by hand.
 *
 * The obvious implementation is `Get-AuthenticodeSignature`, but it lives in the
 * `Microsoft.PowerShell.Security` module, which does not reliably autoload on GitHub's
 * windows-2022 runners ("the module could not be loaded", CouldNotAutoloadMatchingModule) — so the
 * check failed on the environment rather than on the files. Parsing the PE ourselves has no such
 * dependency and, unlike the PowerShell route, also works when the script is run on Linux/macOS.
 *
 * We verify that a certificate is present and names the expected signer. We do not validate the
 * trust chain: the question here is "did somebody else already sign this, so we should keep our
 * hands off", not "does Windows trust it" — that part is Microsoft's problem, not ours.
 *
 * @param {string} filePath
 * @returns {{ signed: false } | { signed: true, certificate: Buffer }}
 */
function readEmbeddedCertificate(filePath) {
  const file = fs.readFileSync(filePath);

  // DOS header -> PE header offset, then the COFF header is 20 bytes before the optional header.
  if (file.length < 0x40 || file.readUInt16LE(0) !== 0x5a4d /* MZ */) {
    throw new Error('not a PE file (missing MZ header)');
  }
  const peOffset = file.readUInt32LE(0x3c);
  if (file.length < peOffset + 24 || file.readUInt32LE(peOffset) !== 0x00004550 /* PE\0\0 */) {
    throw new Error('not a PE file (missing PE signature)');
  }

  // PE32 (0x10b) puts the data directories 96 bytes into the optional header; PE32+ (0x20b), 112.
  const optionalHeaderOffset = peOffset + 24;
  const magic = file.readUInt16LE(optionalHeaderOffset);
  const dataDirectoryOffset = optionalHeaderOffset + (magic === 0x20b ? 112 : 96);

  // Data directory 4 is IMAGE_DIRECTORY_ENTRY_SECURITY. Unlike every other entry, its first field
  // is a plain file offset rather than an RVA.
  const certificateTableOffset = dataDirectoryOffset + 4 * 8;
  if (file.length < certificateTableOffset + 8) {
    throw new Error('truncated PE optional header');
  }
  const offset = file.readUInt32LE(certificateTableOffset);
  const size = file.readUInt32LE(certificateTableOffset + 4);

  if (size === 0 || offset === 0) {
    return { signed: false };
  }
  if (offset + size > file.length) {
    throw new Error('certificate table runs past the end of the file');
  }
  // The WIN_CERTIFICATE header is 8 bytes; the PKCS#7 blob follows it.
  return { signed: true, certificate: file.subarray(offset + 8, offset + size) };
}

/**
 * Check that `filePath` carries an embedded signature naming `expectedSigner`.
 *
 * X.509 names are ASCII in practice, so a substring search over the DER blob is enough to tell
 * "signed by Microsoft" from "signed by someone else" or "not signed at all".
 *
 * @param {string} filePath
 * @param {string} expectedSigner
 * @returns {string | null} an error description, or null if the signature checks out
 */
function verifyExpectedSigner(filePath, expectedSigner) {
  let result;
  try {
    result = readEmbeddedCertificate(filePath);
  } catch (error) {
    return `could not read its certificate table (${error.message})`;
  }
  if (!result.signed) {
    return 'it carries no embedded signature at all';
  }
  if (!result.certificate.includes(Buffer.from(expectedSigner, 'latin1'))) {
    return `its certificate does not name "${expectedSigner}"`;
  }
  return null;
}

function main() {
  const target = path.resolve(process.argv[2] ?? path.join('dist', 'win-unpacked'));

  if (!fs.existsSync(target)) {
    console.error(`Directory not found: ${target}`);
    console.error('Run `npm run package` on Windows first.');
    process.exit(1);
  }

  const binaries = walk(target);
  if (binaries.length === 0) {
    console.error(`No .exe/.dll/.node files found under ${target} — is this the right directory?`);
    process.exit(1);
  }

  /** @type {Record<string, string[]>} */
  const byClass = { sign: [], 'skip-already-signed': [], 'skip-out-of-scope': [], unknown: [] };
  const failures = [];

  for (const binary of binaries) {
    const relativePath = path.relative(target, binary);
    const classification = classifyBinary(binary);
    byClass[classification].push(relativePath);

    if (classification === 'unknown') {
      failures.push(
        `${relativePath}: not covered by any rule in scripts/customSign.js. ` +
          'Add it to SIGN_PATTERNS, or to ALREADY_SIGNED_PATTERNS/OUT_OF_SCOPE_PATTERNS with a reason.'
      );
      continue;
    }

    // "Somebody else already signed it" is a claim we can actually check, so check it.
    if (classification === 'skip-already-signed') {
      const expectedSigner = expectedSignerFor(binary);
      const problem = verifyExpectedSigner(binary, expectedSigner);
      if (problem !== null) {
        failures.push(
          `${relativePath}: ALREADY_SIGNED_PATTERNS claims this is signed by "${expectedSigner}", ` +
            `but ${problem}. It must either be signed by us or moved out of that list.`
        );
      }
    }
  }

  for (const [classification, paths] of Object.entries(byClass)) {
    console.log(`\n${classification} (${paths.length}):`);
    for (const relativePath of paths.sort()) {
      console.log(`  ${relativePath}`);
    }
  }

  if (failures.length > 0) {
    console.error(`\nWindows signing coverage check FAILED (${failures.length}):`);
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exit(1);
  }

  console.log(`\nWindows signing coverage OK: ${binaries.length} binaries, all accounted for.`);
}

if (require.main === module) {
  main();
}

module.exports = { readEmbeddedCertificate, verifyExpectedSigner, walk };
