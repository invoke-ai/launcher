/* eslint-disable no-template-curly-in-string */
import type { Configuration } from 'electron-builder';

export default {
  appId: 'com.invoke.invoke-community-edition',
  productName: 'Invoke Community Edition',
  directories: {
    output: 'dist',
  },
  files: ['package.json', 'out/**/*', 'node_modules/node-pty/**/*'],
  extraResources: [
    {
      from: 'assets/bin',
      to: './bin',
      filter: 'uv*',
    },
  ],
  linux: {
    target: 'AppImage',
    artifactName: '${productName}.${ext}',
    icon: 'assets/icons/icon.png',
  },
  mac: {
    target: {
      target: 'dmg',
      arch: ['arm64'],
    },
    artifactName: '${productName}.${ext}',
    icon: 'assets/icons/icon.icns',
  },
  win: {
    target: 'portable',
    artifactName: '${productName}.${ext}',
    icon: 'assets/icons/icon.ico',
    ...(process.env.ENABLE_SIGNING
      ? {
          signtoolOptions: {
            // Delegate signing to our own script. This script is called once for each executable. The script contains
            // logic to skip signing for executables that are not meant to be signed, such as the bundled uv binary.
            sign: './scripts/customSign.js',
            // We use a custom signing script to handle the signing process, so the selected algorithms are essentially
            // placeholders. We only want to sign the executable once, so we select a single algo.
            signingHashAlgorithms: ['sha256'],
          },
        }
      : {}),
  },
  publish: null,
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    resetAdHocDarwinSignature: true,
  },
} satisfies Configuration;
