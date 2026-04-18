---
'vrchat-albums': patch
---

refactor(ui): 初期セットアップ画面の冗長な案内とステップ番号を削除

- ステップ1「フォルダを設定」・ステップ2「設定を確認」の番号付きUIを削除し、見出し+`PathSettings`+続けるボタンのフラット構成に
- 外側の「VRChatのログと写真のフォルダを設定してください。」を削除（`PathSettings` 内部の「パス設定」セクション説明と重複していたため）
- `PathSettings` を囲っていたカードラッパーを削除し、`SettingsSection` の見出し・余白に一本化
