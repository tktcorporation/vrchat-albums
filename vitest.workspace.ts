import path from 'node:path';
import { defaultExclude, defineConfig } from 'vitest/config';

const sharedConfig = {
  globals: true,
  exclude: [...defaultExclude, 'playwright/**/*'],
  coverage: {
    provider: 'v8' as const,
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
  setupFiles: ['./vitest.setup.ts'],
};

export default [
  defineConfig({
    // フロントエンド用の設定
    test: {
      ...sharedConfig,
      name: 'web',
      environment: 'jsdom',
      include: ['src/**/*.{test,spec}.{js,jsx,ts,tsx}'],
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
  }),
  defineConfig({
    // Electron/Node.js用の設定
    test: {
      ...sharedConfig,
      name: 'electron',
      environment: 'node',
      include: ['electron/**/*.{test,spec}.{js,jsx,ts,tsx}'],
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
  }),
];
