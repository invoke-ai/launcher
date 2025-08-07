/* eslint-disable  @typescript-eslint/no-require-imports */

const { execSync } = require('child_process');
const { writeFileSync, unlinkSync, mkdtempSync } = require('fs');
const { join } = require('path');
const { tmpdir } = require('os');

/**
 * Custom signing script for DigiCert KeyLocker integration with electron-builder
 * This script handles the DigiCert signing process for Windows builds
 *
 * @param {import('app-builder-lib').CustomWindowsSignTaskConfiguration} configuration
 * @returns {Promise<void>}
 */
function sign(configuration) {
  const { path: filePath, hash, isNest } = configuration;

  console.log(`Starting DigiCert KeyLocker signing for: ${filePath}`);
  console.log(`Hash algorithm: ${hash}, isNest: ${isNest}`);

  // Skip signing for bundled uv.exe binary
  if (filePath.includes('\\bin\\uv.exe') || filePath.includes('/bin/uv.exe')) {
    console.log(`Skipping signing for bundled uv.exe binary: ${filePath}`);
    return;
  }

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
    delete process.env.SM_API_KEY;
    delete process.env.SM_CLIENT_CERT_PASSWORD;
    delete process.env.SM_HOST;
    delete process.env.SM_CODE_SIGNING_CERT_SHA1_HASH;
    delete process.env.SM_CLIENT_CERT_FILE_B64;
  }
}

module.exports = { sign };
