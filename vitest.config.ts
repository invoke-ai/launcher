import { resolve } from 'path';
import { defineConfig, mergeConfig } from 'vitest/config';

import electronViteConfig from './electron.vite.config';

export default mergeConfig(
  electronViteConfig,
  defineConfig({
    resolve: {
      alias: {
        '@': resolve(__dirname, './src'),
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      typecheck: {
        enabled: true,
        ignoreSourceErrors: true,
      },
      coverage: {
        provider: 'v8',
        all: false,
        reporter: ['html'],
      },
    },
  })
);
