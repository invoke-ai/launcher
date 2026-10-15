import type { Configuration, WindowsConfiguration } from 'electron-builder';

const getWindowsSigningOptions = (): Partial<WindowsConfiguration> => {
  if (process.env.ENABLE_SIGNING) {
    return {
      // electron-builder only offers `.exe` files to the signing hook unless we widen it here.
      // node-pty ships a `winpty.dll` and several `.node` addons next to `winpty-agent.exe`, and
      // they would otherwise never reach scripts/customSign.js. This only controls what is
      // *offered*; customSign.js still decides what is actually signed.
      signExts: ['.dll', '.node'],
      signtoolOptions: {
        // Delegate signing to our own script. This script is called once for each binary. The
        // script holds the allowlist of what we sign — see scripts/customSign.js.
        sign: './scripts/customSign.js',
        // We use a custom signing script to handle the signing process, so the selected algorithms are essentially
        // placeholders. We only want to sign the executable once, so we select a single algo.
        signingHashAlgorithms: ['sha256'],
      },
    };
  }
  return {};
};

/**
 * The Windows ARM64 launcher is a separate build with its own update channel.
 *
 * electron-builder names a single-arch NSIS installer without the architecture and, on Windows, writes the
 * electron-updater manifest as `latest.yml` whatever the architecture. Published next to the x64 build, the arm64
 * installer would collide with it and an ARM64 launcher reading the shared manifest would be handed the x64
 * installer. Giving the arm64 build the `latest-arm64` channel makes electron-builder write `latest-arm64.yml`
 * and bake that channel into the packaged app-update.yml, so the ARM64 launcher only ever reads its own manifest.
 * The arm64 CI job (and the OSSign signing workflow) set LAUNCHER_WIN_ARCH=arm64; nothing else changes.
 */
const WINDOWS_ARM64_UPDATE_CHANNEL = 'latest-arm64';
const isWindowsArm64Build = process.env.LAUNCHER_WIN_ARCH === 'arm64';

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
    // The arm64 installer carries its architecture in its name; the x64 build keeps its historical name (the
    // README's "latest" link and the signing pipeline depend on it).
    // eslint-disable-next-line no-template-curly-in-string -- electron-builder file-name macros, not a template
    ...(isWindowsArm64Build ? { artifactName: '${productName} Setup ${version}-arm64.${ext}' } : {}),
    ...getWindowsSigningOptions(),
  },
  linux: {
    target: ['AppImage'],
  },
  publish: {
    provider: 'github',
    owner: 'invoke-ai',
    repo: 'launcher',
    // Its own update channel, so the arm64 launcher polls latest-arm64.yml (see the note on the constant).
    ...(isWindowsArm64Build ? { channel: WINDOWS_ARM64_UPDATE_CHANNEL } : {}),
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
    const newArtifactPaths = [...buildResult.artifactPaths];

    console.log('Creating "latest" versions of artifacts...');

    for (const artifactPath of buildResult.artifactPaths) {
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
        newArtifactPaths.push(latestPath);
      } catch (error) {
        console.error(`Failed to create ${latestFileName}:`, error);
      }
    }

    return newArtifactPaths;
  },
} satisfies Configuration;
