import path from 'node:path';
/// <reference types="vitest" />
import { defaultExclude, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    exclude: [...defaultExclude, 'playwright/**/*'],
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{js,jsx,ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/*.test.{js,jsx,ts,tsx}',
        'src/**/*.spec.{js,jsx,ts,tsx}',
        'src/test/**/*',
      ],
    },
    deps: {
      optimizer: {
        web: {
          include: ['@sentry/electron/main'],
          enabled: true,
        },
      },
      interopDefault: true,
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
  optimizeDeps: {
    include: ['electron'],
  },
});
