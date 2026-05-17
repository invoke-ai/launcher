/* eslint-disable  @typescript-eslint/no-require-imports */

const ossign = require('@ossign/ossign');

const signedFilePaths = new Set();

/**
 * Example paths that should be signed, as seen in CI logs:
 * - NSIS Installer: `D:\a\launcher\launcher\dist\Invoke Community Edition Setup 1.7.0-alpha.10.exe`
 * - NSIS Uninstaller: `D:\a\launcher\launcher\dist\__uninstaller-nsis-invoke-community-edition.exe`
 * - Main Launcher Executable: `D:\a\launcher\launcher\dist\win-unpacked\Invoke Community Edition.exe`
 */
const INVOKE_EXE_REGEX = /[iI]nvoke[\s-][cC]ommunity[\s-][eE]dition.*\.exe$/;

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

  // electron-builder will attempt to sign _all_ executables, including things like the bundled uv binary.
  // We only want to sign the NSIS installer, uninstaller, and main executable.
  if (!INVOKE_EXE_REGEX.test(filePath)) {
    console.log(`Skipping signing for binary: ${filePath}`);
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

module.exports = { sign };
