/**
 * Electron/Electrobun メインプロセスのビルド設定。
 *
 * 背景: tRPC ルーターとビジネスロジックのバンドルに使用。
 * Electrobun 移行後もビジネスロジック（electron/module/）のビルドに利用。
 * Electrobun のメインプロセスは Bun が直接実行するため、
 * このビルドは主にテスト・lint 用。
 */
import { builtinModules } from 'node:module';
import { join } from 'node:path';

import { defineConfig } from 'vite';

const nodeBuiltins = [
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
];

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
    emptyOutDir: true,
    target: 'node20',
    lib: {
      entry: {
        index: join(__dirname, 'index.ts'),
        preload: join(__dirname, 'preload.ts'),
      },
      formats: ['cjs'],
    },
    rollupOptions: {
      external: [
        // Electrobun モジュール
        'electrobun/bun',
        'electrobun/view',
        'electrobun',
        // Sentry（将来 @sentry/node に移行予定）
        '@sentry/cli',
        '@sentry/vite-plugin',
        // ネイティブモジュール
        'exiftool-vendored',
        '@napi-rs/image',
        '@resvg/resvg-js',
        'clip-filepaths',
        // Sequelize 関連
        '@sequelize/core',
        '@sequelize/core/decorators-legacy',
        '@sequelize/sqlite3',
        '@sequelize/mariadb',
        '@sequelize/mssql',
        '@sequelize/mysql',
        '@sequelize/postgres',
        '@sequelize/db2',
        '@sequelize/db2-ibmi',
        '@sequelize/snowflake',
        // Node.js 組み込みモジュール
        ...nodeBuiltins,
      ],
      output: {
        entryFileNames: '[name].cjs',
        format: 'cjs',
      },
    },
    sourcemap: true,
    minify: process.env.NODE_ENV === 'production',
    commonjsOptions: {
      transformMixedEsModules: true,
      include: [/node_modules/, /@sequelize\/core/],
    },
  },
  resolve: {
    alias: {
      '@electron': __dirname,
      '@shared': join(__dirname, '../shared'),
    },
  },
  esbuild: {
    target: 'node20',
    supported: {
      decorators: true,
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'node20',
      supported: {
        decorators: true,
      },
    },
  },
});
