---
'vrchat-albums': patch
---

写真メタデータ抽出の連鎖ハング問題を修正: Promise.race のタイムアウト後も instance.read() がキューに残る問題に対処するため、タイムアウト時にexiftoolインスタンスを強制リセットするリカバリロジックを追加
