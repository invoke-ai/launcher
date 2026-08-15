/* eslint-disable  @typescript-eslint/no-require-imports */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { classifyBinary } = require('./customSign.js');

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
 * Ask Windows whether a file carries a valid Authenticode signature. Returns null off Windows,
 * where we cannot check and therefore do not fail.
 *
 * @param {string} filePath
 * @returns {string | null}
 */
function authenticodeStatus(filePath) {
  if (process.platform !== 'win32') {
    return null;
  }
  // A PowerShell *single*-quoted string is literal: backslashes, `$` and backticks are not escapes,
  // so only `'` needs doubling. JSON.stringify would be wrong here — it escapes for JSON, and
  // PowerShell would hand `-LiteralPath` a path with doubled backslashes.
  const script = `(Get-AuthenticodeSignature -LiteralPath '${filePath.replace(/'/g, "''")}').Status`;
  try {
    const status = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
    }).trim();
    // Get-AuthenticodeSignature emits a non-terminating error (empty stdout, exit 0) for a path it
    // cannot resolve, so treat "no answer" as a failure rather than as a pass.
    return status === '' ? 'error: no status returned' : status;
  } catch (error) {
    return `error: ${error.message}`;
  }
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
      const status = authenticodeStatus(binary);
      if (status !== null && status !== 'Valid') {
        failures.push(
          `${relativePath}: ALREADY_SIGNED_PATTERNS claims this is signed upstream, but ` +
            `Get-AuthenticodeSignature reports "${status}". It must either be signed by us or ` +
            'moved out of that list.'
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

main();
