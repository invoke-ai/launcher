/* eslint-disable  @typescript-eslint/no-require-imports */

const fs = require('fs');
const path = require('path');

const { classifyBinary, exemptionFor } = require('./customSign.js');
const { verifyExpectedSigner } = require('./authenticode.js');

/**
 * Verifies that every Windows binary we ship will actually get signed.
 *
 * Signing happens on OSSign's runner, where we never see the logs, so a gap there is invisible
 * until an end user with Smart App Control hits it — which is how
 * https://github.com/invoke-ai/launcher/issues/148 reached a release. This runs against the build
 * .github/workflows/build.yml produces on every PR and checks the two things that can silently go
 * wrong:
 *
 * 1. **Reachability.** electron-builder only hands a file to scripts/customSign.js if
 *    `shouldSignFile` matches it *and* it sits under one of the three roots `signApp` walks (the
 *    package root, non-recursively; `resources/app.asar.unpacked`; `swiftshader`) — plus the
 *    separate paths for extraResources and the NSIS elevation helper. Reasoning about that from the
 *    outside is how you get a check that passes while a binary in `locales/` ships unsigned. So we
 *    do not reason about it: the PR build runs with SIGNING_DRY_RUN set, customSign.js records
 *    every path electron-builder actually offered it, and we require every shipped PE to appear in
 *    that record.
 * 2. **Pre-signed binaries.** customSign.js never signs over an intact third-party signature. That
 *    is the safe default, but it means a binary can quietly stop being signed by us just by
 *    arriving pre-signed. Every such file must be declared in `EXEMPTIONS` with the signer we
 *    expect, and we verify the signature really is that signer's and really does cover the file.
 *
 * Usage: node scripts/checkWindowsSigningCoverage.js <win-unpacked-dir> <dry-run-record>
 */

/**
 * Is this a PE image? Smart App Control gates a file's contents, not its name, so decide by reading
 * the headers — a `.pyd`, `.cpl` or extensionless binary counts just as much as a `.dll`, and an
 * extension-based sweep would never see it.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
function isPortableExecutable(filePath) {
  let handle;
  try {
    handle = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(0x40);
    if (fs.readSync(handle, header, 0, 0x40, 0) < 0x40 || header.readUInt16LE(0) !== 0x5a4d /* MZ */) {
      return false;
    }
    const peOffset = header.readUInt32LE(0x3c);
    const signature = Buffer.alloc(4);
    return fs.readSync(handle, signature, 0, 4, peOffset) === 4 && signature.readUInt32LE(0) === 0x00004550;
  } catch {
    return false;
  } finally {
    if (handle !== undefined) {
      fs.closeSync(handle);
    }
  }
}

/**
 * Collect every file under `dir`.
 *
 * `Dirent.isFile()`/`isDirectory()` are false for symlinks and, on Windows, for the junctions
 * electron-builder's copy helper creates — so resolve those with `statSync` rather than skipping
 * them. `seen` breaks symlink cycles.
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
      // Broken symlink: nothing ships, nothing to check.
      continue;
    }
    if (stats.isDirectory()) {
      found.push(...walk(entryPath, seen));
    } else if (stats.isFile()) {
      found.push(entryPath);
    }
  }
  return found;
}

/**
 * The set of paths customSign.js recorded, normalised for comparison.
 *
 * @param {string} recordPath
 * @returns {Set<string>}
 */
function readOfferedPaths(recordPath) {
  if (!fs.existsSync(recordPath)) {
    throw new Error(
      `no dry-run record at ${recordPath}. The build must run with ENABLE_SIGNING=true and ` +
        'SIGNING_DRY_RUN set to this path, or nothing proves electron-builder ever offered these ' +
        'binaries to scripts/customSign.js.'
    );
  }
  const offered = fs
    .readFileSync(recordPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => path.resolve(line));

  if (offered.length === 0) {
    throw new Error(`the dry-run record at ${recordPath} is empty — the signing hook was never called.`);
  }
  return new Set(offered);
}

function main() {
  const [targetArg, recordArg] = process.argv.slice(2);
  const target = path.resolve(targetArg ?? path.join('dist', 'win-unpacked'));
  const recordPath = path.resolve(recordArg ?? path.join('dist', 'offered-for-signing.txt'));

  if (!fs.existsSync(target)) {
    console.error(`Directory not found: ${target}`);
    console.error('Run `npm run package` on Windows first.');
    process.exit(1);
  }

  let offered;
  try {
    offered = readOfferedPaths(recordPath);
  } catch (error) {
    console.error(`Windows signing coverage check FAILED: ${error.message}`);
    process.exit(1);
  }

  const binaries = walk(target).filter(isPortableExecutable);
  if (binaries.length === 0) {
    console.error(`No PE binaries found under ${target} — is this the right directory?`);
    process.exit(1);
  }

  /** @type {Record<string, string[]>} */
  const byClass = { sign: [], 'skip-already-signed': [] };
  const failures = [];

  for (const binary of binaries) {
    const relativePath = path.relative(target, binary);
    const classification = classifyBinary(binary);
    byClass[classification].push(relativePath);

    if (classification === 'sign') {
      if (!offered.has(path.resolve(binary))) {
        failures.push(
          `${relativePath}: we intend to sign this, but electron-builder never offered it to the ` +
            'signing hook, so it would ship unsigned. Its extension likely needs adding to signExts in ' +
            'electron-builder.config.ts, or it sits outside the directories electron-builder walks.'
        );
      }
      continue;
    }

    // Arrived pre-signed, so customSign.js will leave it alone. That has to be a deliberate,
    // declared decision rather than something that quietly started happening.
    const exemption = exemptionFor(binary);
    if (exemption === null) {
      failures.push(
        `${relativePath}: ships with a third-party signature, so we do not sign it — but nothing ` +
          'declares that. Add it to EXEMPTIONS in scripts/customSign.js with the signer you expect, ' +
          'so the signature gets verified on every build.'
      );
      continue;
    }
    const problem = verifyExpectedSigner(binary, exemption.expectedSigner);
    if (problem !== null) {
      failures.push(
        `${relativePath}: declared as "${exemption.reason}" signed by "${exemption.expectedSigner}", ` +
          `but ${problem}.`
      );
    }
  }

  for (const [classification, paths] of Object.entries(byClass)) {
    console.log(`${classification} (${paths.length}):`);
    for (const relativePath of paths.sort()) {
      console.log(`  ${relativePath}`);
    }
    console.log();
  }

  if (failures.length > 0) {
    console.error(`Windows signing coverage check FAILED (${failures.length}):`);
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exit(1);
  }

  console.log(
    `Windows signing coverage OK: ${binaries.length} PE binaries, all reachable by the signing hook ` +
      `(${offered.size} paths offered in total).`
  );
}

if (require.main === module) {
  main();
}

module.exports = { readOfferedPaths, isPortableExecutable, walk };
