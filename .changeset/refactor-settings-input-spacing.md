---
'vrchat-albums': patch
---

refactor(ui): 設定画面の input 余白と枠を整えた

- Input の過度な装飾 (border + shadow + backdrop-blur) を撤廃し、`bg-muted/40` のフラットな窪み表現に
- SettingsField を新設して label→input→error を gap-3 で統一、label と input の距離を 16px→12px に圧縮
- パス設定セクションのフィールド間余白を 24px→40px に広げ、視覚的階層を明確化
