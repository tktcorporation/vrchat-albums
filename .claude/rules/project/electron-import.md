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

サービスは OS の機能（パス・ダイアログ・クリップボード・通知・ログイン時の起動・ウィンドウの再読み込み・規約同意の通知）と自動更新を `electron/lib/host` の `getHost()`（`shell`・`updater`）から受け取る。サービスを utilityProcess へ移すと `app`・`dialog`・`clipboard`・`shell`・`Notification`・ウィンドウ・electron-updater が使えなくなるため、サービスは殻が実装する `Host` インターフェース（`electron/lib/host/types.ts`）だけに依存させる。

```typescript
// ✅ OK: サービスは殻から受け取る
import { getHost } from '../../lib/host';
const backupDir = path.join(getHost().info.paths.userData, 'backups');
await getHost().shell.notify({ title, body });
```

型だけの import（`import type { X } from 'electron'`）は実行時に残らないので許容する。検出は ast-grep の `electron-toplevel-import`。

処理本体（`electron/api.ts`・`electron/trpc.ts`・`electron/module/`）は、殻の本体（`electron-updater`・`electron/electronUtil.ts`・`electron/index.ts`・`electron/registerElectronHost.ts`・`electron/lib/sentryMain.ts`・`electron/lib/host/electronHost.ts`・`electron/lib/host/electronUpdater.ts`）も import しない。`.js` などの拡張子付きの指定や、`require()`・`import()` にテンプレート文字列で渡す指定も対象にする。検出は ast-grep の `backend-shell-import`。

テストでは `vitest.setup.ts` が `createTestHost()` を登録する。値や操作を確かめたいテストは `registerHost(createTestHost({ paths: { userData: dir } }))` のように登録し直す。

---

## 殻の側での推奨パターン

Electron の API を直接呼ぶのは殻の側（`electron/index.ts`、`electron/electronUtil.ts`、`electron/registerElectronHost.ts`、`electron/lib/host/electronHost.ts`・`electronUpdater.ts`、`electron/lib/sentryMain.ts`、殻より先に読み込まれる `electron/lib/logger.ts`）だけ。共通モジュールでは `electron/lib/electronModules.ts` の遅延取得ヘルパーを使う。

殻は `electron/registerElectronHost.ts` が登録する。`electron/index.ts` はこれを最初に import し、処理本体のモジュールが読み込み時に `getHost()` を使えるようにする（`electron/api.ts` が開く設定ストアの保存先など）。`electron/index.ts` の最初の文がこの import でなければ ast-grep の `register-electron-host-first` が検出する。

画面との tRPC の通信（IPC）は `electron/lib/trpcTransport/` の入口（処理本体は `startTrpcServer`、preload は `exposeTrpcBridge`）だけを使う。構成と殻を換えるときの差し替え範囲は `electron/lib/trpcTransport/index.ts` の JSDoc にある。

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
