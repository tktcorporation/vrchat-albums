---
'vrchat-albums': patch
---

開発・CI で使う Node と、メインプロセス・preload のビルド対象を、Electron 44 に同梱される Node 24 系に揃える。ビルド対象が実行環境と一致するため、Node 24 で使える構文を古い形へ書き換えずに出力する。
