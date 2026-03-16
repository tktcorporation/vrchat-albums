import { builtinModules } from 'node:module';
import { join } from 'node:path';
import { defineConfig } from 'vite';

const rootDir = import.meta.dirname;

// Node.js の組み込みモジュールのリストを作成（'node:' プレフィックス付きと無しの両方）
const nodeBuiltins = [
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
];

export default defineConfig({
  mode: process.env.NODE_ENV || 'development',
  root: rootDir,
  define: {
    'process.env.SENTRY_DSN': JSON.stringify(process.env.SENTRY_DSN),
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
    __SENTRY_RELEASE__: JSON.stringify(process.env.SENTRY_RELEASE),
  },
  build: {
    outDir: join(rootDir, '../main'),
    emptyOutDir: true,
    target: 'node20',
    lib: {
      entry: {
        index: join(rootDir, 'index.ts'),
        preload: join(rootDir, 'preload.ts'),
      },
      formats: ['cjs'],
    },
    // Vite 8: rollupOptions → rolldownOptions（互換レイヤーあり）
    rolldownOptions: {
      external: [
        // Sentry 関連のモジュール
        '@sentry/electron',
        '@sentry/electron/main',
        '@sentry/vite-plugin',
        // Electron 関連のモジュール
        'electron',
        'electron-log',
        'electron-store',
        'electron-unhandled',
        'electron-updater',
        'exiftool-vendored',
        'sharp',
        'clip-filepaths',
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
      ],
      output: {
        entryFileNames: '[name].cjs',
        format: 'cjs',
      },
    },
    sourcemap: true,
    minify: process.env.NODE_ENV === 'production',
    // TypeScript のデコレータをサポートするための設定
    commonjsOptions: {
      transformMixedEsModules: true,
      include: [/node_modules/, /@sequelize\/core/],
    },
  },
  resolve: {
    alias: {
      '@electron': rootDir,
      '@shared': join(rootDir, '../shared'),
    },
  },
});
