---
'vrchat-albums': minor
---

Electron から Electrobun へのフレームワーク移行

- Electrobun (Bun + システム WebView) をベースとした新しいメインプロセスを追加
- tRPC ルーターを Electrobun RPC 経由でブリッジする仕組みを実装
- electron-store を JsonStore (ファイルベース JSON ストア) に置き換え
- electron-log を consola + ファイル出力に置き換え
- @sentry/electron を一時無効化 (将来 @sentry/node に移行予定)
- electron-updater を一時無効化 (将来 Electrobun Updater に移行予定)
- バンドルサイズの大幅削減 (Chromium エンジン非同梱)
