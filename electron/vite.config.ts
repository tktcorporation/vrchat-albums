import { builtinModules } from 'node:module';
import { join } from 'node:path';

import { defineConfig } from 'vite';

// Node.js の組み込みモジュールのリストを作成（'node:' プレフィックス付きと無しの両方）
const nodeBuiltins = [
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
];

/**
 * Electron の main/preload で共通の外部化対象。
 * ネイティブモジュール、Electron API、Sequelize 等はバンドルせず外部化する。
 */
export const electronExternal = [
  // Sentry 関連のモジュール
  '@sentry/electron',
  '@sentry/electron/main',
  '@sentry/electron/preload',
  '@sentry/electron/utility',
  // Electron 関連のモジュール
  'electron',
  'electron-log',
  'electron-store',
  'electron-unhandled',
  'electron-updater',
  '@napi-rs/image',
  '@resvg/resvg-js',
  'clip-filepaths',
  '@vrchat-albums/exif-native',
  // Sequelize 関連のモジュール
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
  // Node.js の組み込みモジュールを外部化
  ...nodeBuiltins,
];

/**
 * Electron main process と処理本体（utilityProcess）のビルド設定。
 *
 * Rolldown によるコード分割が有効。エントリ間の共有モジュール（logger 等）は
 * 自動的にチャンクに分割する。どのエントリも `main/` 直下に出力する。
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
    emptyOutDir: true,
    target: 'node24',
    lib: {
      entry: {
        // main プロセス。ウィンドウ・トレイ・自動更新・OS の操作
        index: join(__dirname, 'index.ts'),
        // 処理本体。main が utilityProcess.fork で起動する（electron/lib/backendProcess/supervisor.ts）。
        // renderWorker.cjs を同じディレクトリから探すので（workerClient.ts）、同じ main/ に出力する
        backend: join(__dirname, 'backend/main.ts'),
        // Main プロセスの応答性を保つため CPU バウンドな画像生成は
        // worker_threads で実行する (ADR-005)。そのための独立エントリ。
        renderWorker: join(__dirname, 'module/imageGenerator/renderWorker.ts'),
      },
      formats: ['cjs'],
    },
    rolldownOptions: {
      external: electronExternal,
      output: {
        entryFileNames: '[name].cjs',
        format: 'cjs',
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
