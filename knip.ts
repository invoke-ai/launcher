import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: ['src/main/index.ts', 'src/renderer/index.ts', 'src/preload/index.ts', 'vite.*.mts'],
  project: ['src/**/*.{ts,tsx}!'],
  // TODO(psyche): these deps are somehow not recognized by knip so we need to explicitly ignore them
  ignoreDependencies: [
    '@electron-forge/plugin-auto-unpack-natives',
    '@electron-forge/plugin-fuses',
    '@electron-forge/plugin-vite',
    '@electron/fuses',
    '@vitejs/plugin-react',
    'typescript-eslint',
    'vite-plugin-eslint',
  ],
  ignoreBinaries: [
    // This is included with @electron/forge
    'electron-rebuild',
  ],
  ignore: ['forge.*.ts'],
  paths: {
    'assets/*': ['assets/*'],
  },
};

export default config;
