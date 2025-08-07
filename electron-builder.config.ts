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
    signtoolOptions: {
      sign: './scripts/customSign.js',
    },
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
