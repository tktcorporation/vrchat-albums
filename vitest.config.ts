import path from 'node:path';
/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
      'playwright/**/*',
    ],
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
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
    projects: [
      // フロントエンド用の設定
      {
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['src/**/*.{test,spec}.{js,jsx,ts,tsx}'],
        },
      },
      // Electron/Node.js用の設定
      {
        test: {
          name: 'electron',
          environment: 'node',
          include: ['electron/**/*.{test,spec}.{js,jsx,ts,tsx}'],
        },
      },
    ],
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
