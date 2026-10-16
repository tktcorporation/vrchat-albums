---
'vrchat-albums': minor
---

アプリに同梱する Electron を 44 系へ更新し、Chromium 152・Node.js 24 で動作するようにした。旧版の Electron に残っていた既知の脆弱性が解消される。エラー監視（Sentry）の SDK も新しい版へ更新し、IP アドレス等のユーザー情報を送らない設定を明示した。Electron 44 は macOS 13 以降が必要で、macOS 12 以前では起動できなくなる。
