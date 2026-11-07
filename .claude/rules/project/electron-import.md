---
paths:
  - 'electron/**/*'
---

# Electron モジュールインポート規約

Playwright テストとの互換性を確保するための Electron インポート規約。

---

## 禁止事項

### トップレベルで Electron の app, BrowserWindow 等をインポートしてはならない

```typescript
// ❌ NEVER: Playwright テストでクラッシュ
import { app } from 'electron';
const logPath = app.getPath('logs');
```

### electron/module のサービスから Electron を使ってはならない

サービスは OS の機能（パス・ダイアログ・クリップボード・通知・ログイン時の起動）を `electron/lib/host` の `getHost()` から受け取る。サービスを utilityProcess へ移すと `app`・`dialog`・`clipboard`・`shell`・`Notification` が使えなくなるため、サービスは殻が実装する `Host` インターフェース（`electron/lib/host/types.ts`）だけに依存させる。

```typescript
// ✅ OK: サービスは殻から受け取る
import { getHost } from '../../lib/host';
const backupDir = path.join(getHost().info.paths.userData, 'backups');
await getHost().shell.notify({ title, body });
```

型だけの import（`import type { X } from 'electron'`）は実行時に残らないので許容する。検出は ast-grep の `electron-toplevel-import`。

テストでは `vitest.setup.ts` が `createTestHost()` を登録する。値や操作を確かめたいテストは `registerHost(createTestHost({ paths: { userData: dir } }))` のように登録し直す。

---

## 殻の側での推奨パターン

Electron の API を直接呼ぶのは殻の側（`electron/index.ts`、`electron/electronUtil.ts`、`electron/lib/host/electronHost.ts`、殻より先に読み込まれる `electron/lib/logger.ts`）だけ。共通モジュールでは `electron/lib/electronModules.ts` の遅延取得ヘルパーを使う。

### 遅延評価（require）

```typescript
// ✅ OK: 遅延評価
import { withElectronApp } from './electronModules';
const isPackaged = withElectronApp(false, (app) => app.isPackaged);
```

---

## 影響範囲

### 共通モジュールでの注意

`logger.ts` など共通モジュールでのトップレベルインポートは**全体に影響**する。

```typescript
// ❌ logger.ts でこれをやると全テストが影響を受ける
import { app } from 'electron';
```

---

## 症状と原因

| 症状                                                                  | 原因                             |
| --------------------------------------------------------------------- | -------------------------------- |
| Playwright テストで `electronApplication.firstWindow: Timeout` エラー | トップレベル Electron インポート |
| テストが無限に待機                                                    | Electron 初期化がブロック        |

---

## デバッグ方法

1. エラーが発生したらインポートチェーンを確認
2. `import { app } from 'electron'` を検索
3. 遅延評価パターンに置き換え

---

## 関連ドキュメント

- `docs/troubleshooting-migration-playwright-timeout.md` - トラブルシューティング詳細
- `.claude/rules/testing.md` - テストガイドライン
