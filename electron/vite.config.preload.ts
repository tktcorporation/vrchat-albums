import { join } from 'node:path';

import { defineConfig } from 'vite';

/**
 * Electron preload スクリプトのビルド設定。
 *
 * preload は Electron サンドボックス内で実行されるため:
 * 1. 他のチャンクを require() できない → 単一ファイルに自己完結させる
 * 2. node_modules を参照できない → 'electron' 以外は全てバンドルに含める
 *
 * @see https://electron-vite.github.io/guide/preload-not-split
 */
export default defineConfig({
  mode: process.env.NODE_ENV ?? 'development',
  root: __dirname,
  define: {
    'process.env.SENTRY_DSN': JSON.stringify(process.env.SENTRY_DSN),
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
    __SENTRY_RELEASE__: JSON.stringify(process.env.SENTRY_RELEASE),
  },
  build: {
    outDir: join(__dirname, '../main'),
    // main process の出力を消さない
    emptyOutDir: false,
    target: 'node20',
    lib: {
      entry: { preload: join(__dirname, 'preload.ts') },
      formats: ['cjs'],
    },
    rolldownOptions: {
      /**
       * サンドボックス内で唯一 require() できるのは 'electron' のみ。
       * `@sentry/electron/preload` 等はバンドルに含める必要がある。
       */
      external: ['electron'],
      output: {
        entryFileNames: '[name].cjs',
        format: 'cjs',
        codeSplitting: false,
      },
    },
    sourcemap: true,
    minify: process.env.NODE_ENV === 'production',
  },
  resolve: {
    alias: {
      '@electron': __dirname,
      '@shared': join(__dirname, '../shared'),
    },
  },
});
