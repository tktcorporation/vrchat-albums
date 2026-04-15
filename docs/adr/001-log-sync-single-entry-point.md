# ADR-001: ログ同期の単一エントリポイント

- **ステータス**: accepted
- **日付**: 2025-12-27
- **関連ルール**: `.claude/rules/project/log-sync.md`

## コンテキスト

VRChat のログファイルと写真の関連付けは、`appendLoglines → loadLogInfo → cache invalidation` の順序で実行する必要がある。個別関数を直接呼び出すと、順序が崩れて写真が間違ったワールドに分類される。

## 決定

ログ同期は単一エントリポイント（`useLogSync` / `syncLogs()`）経由でのみ実行する。個別関数（`appendLoglines`, `loadLogInfo`）の直接呼び出しを禁止する。

## 根拠

- 実行順序の保証: 単一エントリポイントが内部で順序を管理
- データ整合性: キャッシュ無効化が確実に実行される
- テスト容易性: 同期処理全体を一箇所でテスト可能

## 結果

- フロントエンド: `useLogSync` hook 経由
- バックエンド: `syncLogs()` service 経由
- Linter 化候補: `issues/20251227-log-sync-order.md`
