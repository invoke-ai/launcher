/* eslint-disable  @typescript-eslint/no-require-imports */

const fs = require('fs');

/** The PE/COFF `Machine` field values for the Windows architectures we package. */
const PE_MACHINE = { x64: 0x8664, arm64: 0xaa64 };

/**
 * Read the `Machine` field of a PE executable's COFF header.
 *
 * @param {string} filePath
 * @returns {number | undefined} undefined if the file is not a PE executable.
 */
function readPeMachine(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length < 0x40 || buf.readUInt16LE(0) !== 0x5a4d /* MZ */) {
    return undefined;
  }
  const peOffset = buf.readUInt32LE(0x3c);
  if (peOffset + 6 > buf.length || buf.readUInt32LE(peOffset) !== 0x00004550 /* PE\0\0 */) {
    return undefined;
  }
  return buf.readUInt16LE(peOffset + 4);
}

/**
 * Throw unless the bundled uv.exe was built for `arch`.
 *
 * `npm run download win` and `npm run download win-arm64` both write `assets/bin/uv.exe`, and `extraResources` copies
 * whatever is there. A local build that packages one architecture after downloading the other's uv would otherwise ship
 * a launcher whose uv installs the wrong Python - silently, since an emulated uv still runs.
 *
 * @param {string} uvPath
 * @param {'x64' | 'arm64'} arch
 */
function assertUvMatchesArch(uvPath, arch) {
  const expected = PE_MACHINE[arch];
  if (expected === undefined) {
    throw new Error(`No uv architecture check for Windows ${arch}`);
  }
  if (!fs.existsSync(uvPath)) {
    throw new Error(`${uvPath} does not exist - run \`npm run download ${arch === 'arm64' ? 'win-arm64' : 'win'}\``);
  }
  const machine = readPeMachine(uvPath);
  if (machine !== expected) {
    const found =
      Object.keys(PE_MACHINE).find((key) => PE_MACHINE[key] === machine) ?? `machine 0x${machine?.toString(16)}`;
    throw new Error(
      `${uvPath} is the ${found} build, but this is the Windows ${arch} package - run \`npm run download ${arch === 'arm64' ? 'win-arm64' : 'win'}\``
    );
  }
}

module.exports = { readPeMachine, assertUvMatchesArch, PE_MACHINE };
