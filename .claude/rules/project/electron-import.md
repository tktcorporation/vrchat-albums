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

サービスは OS の機能（パス・ダイアログ・クリップボード・通知・ログイン時の起動・ウィンドウの再読み込み・規約同意の通知）と自動更新を `electron/lib/host` の `getHost()`（`shell`・`updater`）から受け取る。サービスは utilityProcess（処理本体）で動き、そこには `app`・`dialog`・`clipboard`・`shell`・`Notification`・ウィンドウ・electron-updater が無い。サービスは殻が実装する `Host` インターフェース（`electron/lib/host/types.ts`）だけに依存させ、殻の操作は main への要求として実行される（`electron/lib/hostRpc/`）。

```typescript
// ✅ OK: サービスは殻から受け取る
import { getHost } from '../../lib/host';
const backupDir = path.join(getHost().info.paths.userData, 'backups');
await getHost().shell.notify({ title, body });
```

型だけの import（`import type { X } from 'electron'`）は実行時に残らないので許容する。検出は ast-grep の `electron-toplevel-import`。

処理本体（`electron/backend/`・`electron/api.ts`・`electron/trpc.ts`・`electron/module/`）は、殻の本体（`electron-updater`・`@sentry/electron/main`・`electron/electronUtil.ts`・`electron/index.ts`・`electron/lib/sentryMain.ts`・`electron/lib/host/electronHost.ts`・`electron/lib/host/electronUpdater.ts`・`electron/lib/backendProcess/supervisor.ts`）も import しない。`.js` などの拡張子付きの指定や、`require()`・`import()` にテンプレート文字列で渡す指定も対象にする。検出は ast-grep の `backend-shell-import`。

テストでは `vitest.setup.ts` が `createTestHost()` を登録する。値や操作を確かめたいテストは `registerHost(createTestHost({ paths: { userData: dir } }))` のように登録し直す。

---

## プロセスの分担

| プロセス                   | 入口                       | 持つもの                                                                                     |
| -------------------------- | -------------------------- | -------------------------------------------------------------------------------------------- |
| main                       | `electron/index.ts`        | ウィンドウ・トレイ・自動更新・OS の操作（`HostShell` の実装）・エラー監視の初期化            |
| 処理本体（utilityProcess） | `electron/backend/main.ts` | tRPC の router・サービス・DB・worker・設定ファイルの書き込み・バックグラウンド同期のタイマー |

main は処理本体のモジュール（`electron/api.ts`・`electron/trpc.ts`・`electron/module/` のサービス・Sequelize・ネイティブモジュール）を読み込まない。設定ファイルを書くのは処理本体だけで、main は `electron/lib/settingsFile.ts` で読むだけにする（理由は同ファイルの JSDoc）。

処理本体の入口は、main から殻の情報が届いてから殻を登録し、その後で処理本体のモジュールを動的に読み込む。処理本体のモジュールには、読み込まれた時点で `getHost()` を使うもの（`electron/api.ts` が開く設定ストアの保存先など）があるため。

## 殻の側での推奨パターン

Electron の main 用の API を直接呼ぶのは main の殻の側（`electron/index.ts`、`electron/electronUtil.ts`、`electron/lib/host/electronHost.ts`・`electronUpdater.ts`、`electron/lib/sentryMain.ts`、`electron/lib/backendProcess/supervisor.ts`、tRPC の仲介 `electron/lib/trpcTransport/index.ts`）だけ。共通モジュールでは `electron/lib/electronModules.ts` の遅延取得ヘルパーを使う。両方のプロセスで読み込まれる `electron/lib/logger.ts` は、読み込んだプロセスに合わせてログの保存先を決め、エラー監視の送り先は各プロセスの入口から `configureErrorReporting` で受け取る。

画面との tRPC の通信は `electron/lib/trpcTransport/` の入口（main は `startTrpcBroker`、処理本体は `serveTrpcOnPort`、preload は `exposeTrpcBridge`）だけを使う。main と処理本体の起動・終了・指示の取り決めは `electron/lib/backendProcess/protocol.ts`、殻の操作の要求と応答は `electron/lib/hostRpc/protocol.ts` にある。構成と殻を換えるときの差し替え範囲は `electron/lib/trpcTransport/index.ts` の JSDoc にある。

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
