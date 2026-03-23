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
    projects: [
      // フロントエンド用の設定
      {
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
      // Electron/Node.js ユニットテスト用の設定
      {
        test: {
          name: 'electron',
          environment: 'node',
          include: ['electron/**/*.{test,spec}.{js,jsx,ts,tsx}'],
          exclude: [
            ...defaultExclude,
            '**/*.integration.test.{js,jsx,ts,tsx}',
            '**/*.memory.integration.test.{js,jsx,ts,tsx}',
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
      // Electron/Node.js 統合テスト用の設定（DB使用のため逐次実行）
      {
        test: {
          name: 'electron-integration',
          environment: 'node',
          include: [
            'electron/**/*.integration.test.{js,jsx,ts,tsx}',
            'electron/**/*.memory.integration.test.{js,jsx,ts,tsx}',
          ],
          setupFiles: ['./vitest.setup.ts'],
          // 統合テストはSQLiteのファイルロック競合を避けるため逐次実行
          fileParallelism: false,
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
        test: {
          name: 'scripts',
          environment: 'node',
          include: ['scripts/**/*.{test,spec}.{js,jsx,ts,tsx}'],
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
