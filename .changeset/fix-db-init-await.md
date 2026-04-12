---
'vrchat-albums': patch
---

fix: syncRDBClient のマイグレーションスキップが機能していなかったバグを修正

match() の結果を await していなかったため、同一バージョンでの再起動時も
毎回 7 テーブルの ALTER TABLE スキーマ比較が実行されていた。
