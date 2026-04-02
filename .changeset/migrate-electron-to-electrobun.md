---
'vrchat-albums': minor
---

Electron から Electrobun へのフレームワーク移行

- Electrobun (Bun + システム WebView) をベースとした新しいメインプロセスを追加
- tRPC ルーターを Electrobun RPC 経由でブリッジする仕組みを実装
- electron-store を JsonStore (ファイルベース JSON ストア) に置き換え
- electron-log を consola + ファイル出力に置き換え
- @sentry/electron を @sentry/node (main) + @sentry/browser (renderer) に移行
- electron-updater を Electrobun Updater API に移行
- クリップボード画像コピーを clip-filepaths で継続利用
- バックグラウンドログ同期タイマー (6時間間隔) を Electrobun 対応で復旧
- アプリバージョン取得を Resources/version.json 経由に移行
- バンドルサイズの大幅削減 (Chromium エンジン非同梱)
