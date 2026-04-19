---
'vrchat-albums': patch
---

refactor(electron): Effect TS の重複ボイラープレートを SSOT 化

各 tRPC コントローラーで重複していた `Effect.mapError(e => UserFacingError.withStructuredInfo({...}))`
パターンを `electron/lib/errorMapping.ts` の `toUserFacing` / `mapByTag` /
プリセットマッパー (`mapToFileOperationError` / `mapToOpenPathError` / `mapToUnknownError`)
に集約。Electron 環境検出パターンも `withElectronApp(fallback, fn)` に統一。

ユーザー向け挙動の変更はなし。エラーメッセージの内容と表示タイミングは旧コードと等価。

- 新規: `electron/lib/errorMapping.ts`, `errorMapping.test.ts`
- 追加: `electron/lib/electronModules.ts` に `withElectronApp` ヘルパー
- 削除: `electron/lib/dbHelper.ts` の未使用コメントアウト 150 行と未使用エラー型
- ast-grep ルール 3 本追加/更新で将来の再発を防止
