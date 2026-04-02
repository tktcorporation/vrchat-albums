/**
 * Electrobun ビルド設定。
 *
 * 背景: Electron から Electrobun への移行に伴い新規作成。
 * Bun ランタイム上でメインプロセスを実行し、システム WebView でレンダラーを表示する。
 *
 * 参照: https://blackboard.sh/electrobun/docs/apis/cli/build-configuration/
 */
import type { ElectrobunConfig } from 'electrobun';

export default {
  app: {
    name: 'VRChatAlbums',
    identifier: 'com.tktcorporation.vrchat-albums',
    version: '0.28.0',
  },
  runtime: {
    exitOnLastWindowClosed: false,
  },
  build: {
    bun: {
      entrypoint: 'src/bun/index.ts',
    },
    views: {
      'main-ui': {
        entrypoint: 'src/main-ui/index.ts',
      },
    },
    copy: {
      'src/main-ui/index.html': 'views/main-ui/index.html',
      'assets/': 'assets/',
      'electron/resources/fonts/': 'fonts/',
    },
  },
  release: {
    baseUrl: '',
  },
} satisfies ElectrobunConfig;
