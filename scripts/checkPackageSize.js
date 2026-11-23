/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');

// Download sizes in bytes from the published v1.9.0-rc.1 release. A dependency
// upgrade that grows an installer by more than 15% warrants explicit review.
const releaseSizes = {
  'win32-x64': { '.exe': 113202232 },
  'win32-arm64': { '.exe': 113916776 },
  'darwin-arm64': { '.dmg': 132950130, '.zip': 128354509 },
  'linux-x64': { '.appimage': 145780049 },
};

function checkPackageSize(directory, target, version) {
  const baseline = releaseSizes[target];
  if (!baseline) {
    throw new Error(`No release size baseline for ${target}`);
  }
  const files = fs.readdirSync(directory);
  for (const [extension, bytes] of Object.entries(baseline)) {
    const candidates = files.filter((file) => file.includes(version) && file.toLowerCase().endsWith(extension));
    if (candidates.length !== 1) {
      throw new Error(`Expected one versioned ${extension} for ${target}, found ${candidates.length}`);
    }
    const name = candidates[0];
    const size = fs.statSync(path.join(directory, name)).size;
    const limit = Math.ceil(bytes * 1.15);
    console.log(`${name}: ${size} bytes (baseline ${bytes}, limit ${limit})`);
    if (size === 0 || size > limit) {
      throw new Error(`Unexpected download size for ${name}: ${size} bytes`);
    }
  }
}

if (require.main === module) {
  checkPackageSize('dist', `${process.platform}-${process.arch}`, require('../package.json').version);
}
module.exports = { checkPackageSize };
