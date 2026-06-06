import type { KnipConfig } from 'knip';

const config = {
  entry: [
    'src/main/index.ts',
    'src/renderer/index.ts',
    'src/preload/index.ts',
    'electron.vite.config.ts',
    // Invoked by electron-builder via a string path (electron-builder.config.ts), which knip
    // can't follow. List it here so its @ossign/ossign import is recognized as used.
    'scripts/customSign.js',
  ],
  project: ['src/**/*.{ts,tsx}!'],
  // TODO(psyche): these deps are somehow not recognized by knip so we need to explicitly ignore them
  ignoreDependencies: [
    '@vitejs/plugin-react',
    'typescript-eslint',
    'vite-plugin-eslint',
    // Type-only JSDoc import in scripts/customSign.js; provided transitively by electron-builder.
    'app-builder-lib',
  ],
  ignoreBinaries: [
    // This is included with @electron/forge
    'electron-rebuild',
  ],
  ignore: ['forge.*.ts', 'src/main/util.ts'],
  paths: {
    'assets/*': ['assets/*'],
  },
} satisfies KnipConfig;

export default config;
