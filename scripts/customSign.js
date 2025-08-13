/* eslint-disable  @typescript-eslint/no-require-imports */

const { execSync } = require('child_process');
const { writeFileSync, unlinkSync, mkdtempSync } = require('fs');
const { join } = require('path');
const { tmpdir } = require('os');

const signedFilePaths = new Set();

/**
 * Example paths that should be signed, as seen in CI logs:
 * - NSIS Installer: `D:\a\launcher\launcher\dist\Invoke Community Edition Setup 1.7.0-alpha.10.exe`
 * - NSIS Uninstaller: `D:\a\launcher\launcher\dist\__uninstaller-nsis-invoke-community-edition.exe`
 * - Main Launcher Executable: `D:\a\launcher\launcher\dist\win-unpacked\Invoke Community Edition.exe`
 */
const INVOKE_EXE_REGEX = /[iI]nvoke[\s-][cC]ommunity[\s-][eE]dition.*\.exe$/;

/**
 * Custom signing script for DigiCert KeyLocker integration with electron-builder
 * This script handles the DigiCert signing process for Windows builds
 *
 * @param {import('app-builder-lib').CustomWindowsSignTaskConfiguration} configuration
 * @returns {Promise<void>}
 */
function sign(configuration) {
  const { path: filePath } = configuration;

  if (signedFilePaths.has(filePath)) {
    console.log(`Skipping already signed binary: ${filePath}`);
    return;
  }

  // electron-builder will attempt to sign _all_ executables, including things like win-pty.exe.
  // We only want to sign the NSIS installer, uninstaller, and main executable.
  if (!INVOKE_EXE_REGEX.test(filePath)) {
    console.log(`Skipping signing for binary: ${filePath}`);
    return;
  }

  console.log(`Starting DigiCert KeyLocker signing for: ${filePath}`);

  // Check required environment variables
  const requiredVars = [
    'SM_HOST',
    'SM_API_KEY',
    'SM_CLIENT_CERT_PASSWORD',
    'SM_CLIENT_CERT_FILE_B64',
    'SM_CODE_SIGNING_CERT_SHA1_HASH',
  ];

  for (const envVar of requiredVars) {
    if (!process.env[envVar]) {
      throw new Error(`Missing required environment variable: ${envVar}`);
    }
  }

  let tempCertDir = null;
  let tempCertPath = null;

  try {
    // Create secure temporary directory for certificate
    tempCertDir = mkdtempSync(join(tmpdir(), 'cert-'));
    tempCertPath = join(tempCertDir, 'cert.p12');

    console.log('Decoding certificate from base64...');

    // Decode base64 certificate and write to temp file
    const certData = Buffer.from(process.env.SM_CLIENT_CERT_FILE_B64, 'base64');
    writeFileSync(tempCertPath, certData);

    // Set certificate file path for SSM tools
    process.env.SM_CLIENT_CERT_FILE = tempCertPath;

    console.log('Setting up DigiCert SSM tools...');

    // Download SSM tools if not already present
    try {
      execSync('smctl.exe --version', { stdio: 'pipe' });
      console.log('SSM tools already installed');
    } catch {
      console.log('Downloading DigiCert SSM tools...');

      const downloadCmd = `curl -X GET "https://one.digicert.com/signingmanager/api-ui/v1/releases/smtools-windows-x64.msi/download" -H "x-api-key: ${process.env.SM_API_KEY}" -o smtools-windows-x64.msi --fail --silent --show-error`;
      execSync(downloadCmd, { stdio: 'inherit' });

      console.log('Installing SSM tools...');
      execSync('msiexec /i smtools-windows-x64.msi /quiet /qn /norestart', {
        stdio: 'inherit',
        timeout: 120000, // 2 minute timeout for installation
      });

      // Clean up installer
      try {
        unlinkSync('smtools-windows-x64.msi');
      } catch (cleanupError) {
        console.warn('Could not remove SSM installer:', cleanupError.message);
      }
    }

    console.log('Configuring SSM KSP...');

    // Configure SSM Key Storage Provider
    execSync('smksp_registrar.exe list', { stdio: 'inherit' });
    execSync('smctl.exe keypair ls', { stdio: 'inherit' });
    execSync('C:\\Windows\\System32\\certutil.exe -csp "DigiCert Signing Manager KSP" -key -user', {
      stdio: 'inherit',
    });
    execSync('smksp_cert_sync.exe', { stdio: 'inherit' });

    console.log(`Signing ${filePath}...`);

    // Build signtool command
    const signtoolArgs = [
      'sign',
      `/sha1 ${process.env.SM_CODE_SIGNING_CERT_SHA1_HASH}`,
      '/tr http://timestamp.digicert.com',
      '/td SHA256',
      '/fd SHA256',
      '/v',
      `"${filePath}"`,
    ];

    const signtoolCmd = `signtool.exe ${signtoolArgs.join(' ')}`;

    try {
      execSync(signtoolCmd, {
        stdio: 'inherit',
        timeout: 120000, // 2 minute timeout for signing
      });
    } catch (signError) {
      throw new Error(`Signing failed: ${signError.message}`);
    }

    console.log('Signing successful. Verifying signature...');

    // Verify signature
    try {
      execSync(`signtool.exe verify /v /pa "${filePath}"`, {
        stdio: 'inherit',
        timeout: 30000, // 30 second timeout for verification
      });
    } catch (verifyError) {
      throw new Error(`Signature verification failed: ${verifyError.message}`);
    }

    console.log('Signature verification successful');

    signedFilePaths.add(filePath);
  } catch (error) {
    console.error('Signing process failed:', error.message);
    throw error;
  } finally {
    // Clean up sensitive data
    console.log('Cleaning up temporary files...');

    if (tempCertPath) {
      try {
        unlinkSync(tempCertPath);
      } catch (cleanupError) {
        console.warn('Could not remove temporary certificate file:', cleanupError.message);
      }
    }

    if (tempCertDir) {
      try {
        const { rmSync } = require('fs');
        rmSync(tempCertDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.warn('Could not remove temporary certificate directory:', cleanupError.message);
      }
    }

    // Clear sensitive environment variables from process
    delete process.env.SM_CLIENT_CERT_FILE;
  }
}

module.exports = { sign };
