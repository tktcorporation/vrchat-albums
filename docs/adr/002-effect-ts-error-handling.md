# ADR-002: Effect TS によるエラーハンドリング

- **ステータス**: accepted
- **日付**: 2025-12-27
- **関連ルール**: `.claude/rules/error-handling.md`

## コンテキスト

try-catch はエラーの型情報を失い、exhaustive なハンドリングが不可能。catch ブロック内でエラーを握りつぶすバグが頻発していた。

## 決定

try-catch を禁止し、Effect TS の `Effect.try` / `Effect.tryPromise` を標準パターンとする。エラー型は具体的に定義し、ts-pattern でパターンマッチする。

## 根拠

- 型安全: `Effect.Effect<T, E>` でエラー型が明示される
- 網羅性: ts-pattern の `.exhaustive()` で全エラーパターンをカバー
- 伝播の明示性: Effect のパイプラインでエラーの伝播が可視化される

## 許容される例外

1. `finally` でリソースクリーンアップが必要な場合（`Effect.acquireRelease` を優先検討）
2. Electron 環境検出パターン（`require('electron')` の try-catch）
3. ts-pattern でエラー分類し、予期しないエラーを再スローする場合

## 結果

- Service 層: `Effect.Effect<T, E>` で返却
- tRPC 層: `runEffect()` で `UserFacingError` に変換
- Frontend 層: `parseErrorFromTRPC()` + Toast で表示
- Linter: `pnpm lint:effect`
