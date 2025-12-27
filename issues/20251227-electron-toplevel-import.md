# Linter化候補: Electronトップレベルインポート禁止

## 現状の規約
```xml
<pattern name="Electron Module Import" priority="critical">
  <forbidden>トップレベルで electron の app, BrowserWindow 等をインポート</forbidden>
</pattern>
```

## 現在の違反状況
```
electron/module/settings/service.ts
electron/module/electronUtil/service.ts
electron/module/backgroundSettings/controller/backgroundSettingsController.ts
electron/module/vrchatLog/exportService/exportService.ts
electron/index.ts (これはエントリポイントなのでOK)
```

## なぜLinter化すべきか
- Playwrightテストでクラッシュする原因になる
- 手動チェックでは見落としやすい
- 新規ファイル追加時に気づかず違反しがち

## 実装案
### GritQL (推奨)
`.grit/patterns/electron_toplevel_import.md`:
```grit
language js

// Detect top-level electron imports (not in index.ts)
`import { $imports } from 'electron'` where {
    $imports <: contains or { `app`, `BrowserWindow`, `dialog`, `shell` },
    // Exclude entry point
    $filename <: not r"index\.ts$"
}
```

### 除外ルール
- `electron/index.ts` はエントリポイントなので許可
- テストファイル (`*.test.ts`) も除外

## 優先度
高

## 備考
- 遅延評価パターン (`require('electron')`) への移行ガイドも必要
