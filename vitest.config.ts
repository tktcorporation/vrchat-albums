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
        client: {
          include: ['@sentry/electron/main'],
          enabled: true,
        },
      },
      interopDefault: true,
    },
    // inline project はルートの test 設定を継承しない（extends: false）。継承させると
    // ルートの setupFiles が各 project の setupFiles に追記され、electron では
    // vitest.setup.ts が二重に、web と scripts では不要な vitest.setup.ts が走る。
    projects: [
      // フロントエンド用の設定
      {
        extends: false,
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['src/**/*.{test,spec}.{js,jsx,ts,tsx}'],
          setupFiles: ['./vitest.setup.web.ts'],
        },
        resolve: {
          alias: {
            '@': path.resolve(__dirname, './src'),
            '@shared': path.resolve(__dirname, './shared'),
          },
        },
      },
      // Electron/Node.js用の設定
      {
        extends: false,
        test: {
          name: 'electron',
          environment: 'node',
          include: [
            'electron/**/*.{test,spec}.{js,jsx,ts,tsx}',
            'shared/**/*.{test,spec}.{js,jsx,ts,tsx}',
          ],
          setupFiles: ['./vitest.setup.ts'],
        },
        resolve: {
          alias: {
            '@': path.resolve(__dirname, './src'),
            '@shared': path.resolve(__dirname, './shared'),
          },
        },
      },
      // Scripts用の設定
      {
        extends: false,
        test: {
          name: 'scripts',
          environment: 'node',
          include: ['scripts/**/*.{test,spec}.{js,jsx,ts,tsx}'],
          // テンプレートから同期される docs-lifecycle は bun:test で書かれ、bun で実行する
          exclude: [...defaultExclude, 'scripts/docs-lifecycle/**'],
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
