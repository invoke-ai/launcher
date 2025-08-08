import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: ['src/main/index.ts', 'src/renderer/index.ts', 'src/preload/index.ts', 'electron.vite.config.ts'],
  project: ['src/**/*.{ts,tsx}!'],
  // TODO(psyche): these deps are somehow not recognized by knip so we need to explicitly ignore them
  ignoreDependencies: ['@vitejs/plugin-react', 'typescript-eslint', 'vite-plugin-eslint'],
  ignoreBinaries: [
    // This is included with @electron/forge
    'electron-rebuild',
  ],
  ignore: ['forge.*.ts', 'src/main/util.ts'],
  paths: {
    'assets/*': ['assets/*'],
  },
};

export default config;
