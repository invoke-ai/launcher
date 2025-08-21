import type { Configuration, WindowsConfiguration } from 'electron-builder';

const getWindowsSigningOptions = (): Partial<WindowsConfiguration> => {
  if (process.env.ENABLE_SIGNING) {
    return {
      signtoolOptions: {
        // Delegate signing to our own script. This script is called once for each executable. The script contains
        // logic to skip signing for executables that are not meant to be signed, such as the bundled uv binary.
        sign: './scripts/customSign.js',
        // We use a custom signing script to handle the signing process, so the selected algorithms are essentially
        // placeholders. We only want to sign the executable once, so we select a single algo.
        signingHashAlgorithms: ['sha256'],
      },
    };
  }
  return {};
};

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
  win: {
    target: ['nsis'],
    ...getWindowsSigningOptions(),
  },
  linux: {
    target: ['AppImage'],
  },
  publish: {
    provider: 'github',
    owner: 'invoke-ai',
    repo: 'launcher',
  },
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    resetAdHocDarwinSignature: true,
  },
  electronUpdaterCompatibility: '>= 2.16',
  afterAllArtifactBuild: (buildResult) => {
    const fs = require('fs');
    const path = require('path');

    const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    const version = packageJson.version;
    const outDir = buildResult.outDir;
    const artifactPaths = buildResult.artifactPaths;

    console.log('Creating "latest" versions of artifacts...');

    for (const artifactPath of artifactPaths) {
      const fileName = path.basename(artifactPath);

      // Skip files that don't contain the version number
      if (!fileName.includes(version)) {
        continue;
      }

      // Create the "latest" filename by replacing the version with "latest"
      const latestFileName = fileName.replace(version, 'latest');
      const latestPath = path.join(outDir, latestFileName);

      try {
        // Copy the file with the new name
        fs.copyFileSync(artifactPath, latestPath);
        console.log(`Created: ${latestFileName}`);

        // Add the new file to the artifacts list so it gets uploaded
        buildResult.artifactPaths.push(latestPath);
      } catch (error) {
        console.error(`Failed to create ${latestFileName}:`, error);
      }
    }

    return buildResult.artifactPaths;
  },
} satisfies Configuration;
