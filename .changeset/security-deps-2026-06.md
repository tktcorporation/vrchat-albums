---
'vrchat-albums': patch
---

セキュリティ修正: 脆弱性のある依存を更新

- `exiftool-vendored`: `^34.3.0` → `^36.0.0`
  - GHSA-cw26-7653-2rp5 (タグ名経由の引数インジェクション, high)
  - 同梱 ExifTool バイナリ (exiftool-vendored.pl 13.59.0) 側の修正を取り込む。EXIF 読み取りで runtime に乗るため対応
- `tar` override: `>=7.5.11` → `>=7.5.16`
  - node-sqlite3 経由の node-tar 脆弱性 (PAX size override, moderate) を解消。既存 override の追従更新
