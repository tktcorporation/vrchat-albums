---
'vrchat-albums': patch
---

World Join 画像の EXIF 書き込み失敗を修正。JPEG バッファに対して .png 拡張子の一時ファイルを使用していたため exiftool がフォーマット不一致エラーを返していた問題を、マジックバイトから拡張子を自動判定するように修正。
