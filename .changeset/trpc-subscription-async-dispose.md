---
'vrchat-albums': patch
---

アプリ内の通知と起動時の読み込みの進み具合が届かず、表示されない問題を直す。Electron 44 に入っている Node では非同期ジェネレーターが標準で `Symbol.asyncDispose` を持つため、通信ライブラリ（trpc-electron）がメインプロセスから画面への購読を始めるたびにエラーになっていた。
