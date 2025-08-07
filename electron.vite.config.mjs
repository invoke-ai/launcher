import react from '@vitejs/plugin-react-swc';
import { defineConfig } from 'electron-vite';
import { resolve } from 'path';
import { createHtmlPlugin } from 'vite-plugin-html';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  main: {
    plugins: [tsconfigPaths()],
    build: {
      lib: {
        entry: resolve('src/main/index.ts'),
      },
      rollupOptions: {
        external: ['electron', 'node-pty'],
      },
    },
  },
  preload: {
    plugins: [tsconfigPaths()],
    build: {
      lib: {
        entry: resolve('src/preload/index.ts'),
      },
      rollupOptions: {
        external: ['electron', 'node-pty'],
      },
    },
  },
  renderer: {
    root: '.',
    plugins: [
      react(),
      tsconfigPaths(),
      createHtmlPlugin({
        // index.dev.html has react devtools
        template: process.env.NODE_ENV === 'development' ? './index.dev.html' : './index.html',
      }),
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve('./index.html'),
        },
        external: ['electron', 'node-pty'],
      },
    },
  },
});
