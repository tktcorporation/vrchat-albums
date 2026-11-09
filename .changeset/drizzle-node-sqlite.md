---
'vrchat-albums': patch
---

DB の読み書きを Drizzle ORM と Node 組み込みの SQLite に移す。既存の DB は初回の起動時に `backups` フォルダへ複製してから引き継ぐ。
