import type { KnipConfig } from 'knip';

/**
 * Knip configuration for unused code detection
 *
 * 設定はパッケージごとに `workspaces` のキー（pnpm-workspace.yaml の packages と
 * 同じパス）の下に置き、packages/* の生成コードやフィクスチャはそのパッケージの
 * 設定で除外する。
 *
 * scripts/ も解析対象にし、除外はテンプレート同期ファイルとテスト用フィクスチャに限る。
 * css を project に含め、`@import` で読み込む依存とどこからも読まれない css を検出する。
 *
 * src/ と electron/ は tRPC で密結合しているため、別パッケージに分けず
 * ルートワークスペース '.' の 1 つのプロジェクトとして解析する。
 */
const config: KnipConfig = {
  workspaces: {
    '.': {
      // Renderer の src/main.tsx は vite プラグインが index.html から検出する
      entry: [
        // Main process。electron/vite.config.ts の lib.entry と一致させる
        'electron/index.ts',
        // worker_threads のエントリ。workerClient.ts がビルド後の renderWorker.cjs を
        // パス文字列で起動するため import では辿れない (ADR-005)
        'electron/module/imageGenerator/renderWorker.ts',
        // Preload。electron/vite.config.preload.ts の lib.entry
        'electron/preload.ts',
        // package.json の dev:electron / build:electron が -c で渡す vite 設定
        'electron/vite.config.ts',
        'electron/vite.config.preload.ts',
        // package.json の scripts から tsx / node で直接実行するスクリプト
        'scripts/*.{ts,mts,mjs}',
        // electron-builder の設定（package.json の electron-dist が --config で渡す）
        'electron-builder.cjs',
      ],
      project: [
        // src/index.css の @import（tw-animate-css 等）を辿るため css も含める
        'src/**/*.{ts,tsx,css}',
        'electron/**/*.ts',
        'shared/**/*.ts',
        'scripts/**/*.{ts,mts,mjs}',
        'playwright/**/*.ts',
      ],
      ignore: [
        // shadcn/ui の生成コンポーネント。未使用の variant も上流のまま保持する
        'src/components/ui/**',
        // Design token types - kept for future type safety
        'src/v2/constants/ui.ts',
        // ziku でテンプレートから同期されるファイル（.ziku/ziku.jsonc の include）。
        // このリポジトリでは使わない経路（pnpm exec vp 等）を含み、ローカルで直しても次の同期で戻る
        'scripts/docs-lifecycle/**',
        'scripts/generate-agent-adapters.ts',
        // lint スクリプトのテストが読み込むフィクスチャ（意図的に未使用コードを含む）
        'scripts/test-fixtures/**',
        // ziku でテンプレートから同期される bun 実行ツール。依存はツール自身の package.json が持つ
        'tools/agent-fleet/**',
      ],
      ignoreBinaries: [
        // Aikido Safe Chain が実行時に shim として提供するコマンド。
        // .github/workflows/supply-chain-scan.yml で `pnpm safe-chain-verify` として
        // 使うが、依存パッケージのバイナリではないため knip には登録できない。
        'safe-chain-verify',
      ],
      ignoreDependencies: [
        '@antfu/ni',
        // electron-builder の optional peer dependency（直接 import されないが macOS/Windows ビルドに必要）
        'electron-builder-squirrel-windows',
      ],
    },
    'packages/exif-native': {
      // napi-rs 生成コード（index.js/index.d.ts）は knip のスコープ外
      ignore: ['**'],
    },
    'packages/lint-contrast': {
      // vitest が動的 glob で読み込むフィクスチャ
      ignore: ['test-fixtures/**'],
    },
  },
  // Don't report unused exports in entry files (tRPC routers)
  includeEntryExports: false,
  // Ignore exports that are used within the same file
  ignoreExportsUsedInFile: true,
};

export default config;
