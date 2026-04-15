# Architecture Decision Records

設計判断の根拠を記録する。CLAUDE.md の禁止事項は対応する ADR 番号を参照すること。

## フォーマット

- ファイル名: `NNN-<slug>.md` (NNN = 3桁連番)
- ステータス: `proposed` → `accepted` → `superseded` / `deprecated`
- 一度 accepted になった ADR は内容を変更しない（superseded で新 ADR を作成）

## 一覧

| ADR                                         | タイトル                           | ステータス |
| ------------------------------------------- | ---------------------------------- | ---------- |
| [001](./001-log-sync-single-entry-point.md) | ログ同期の単一エントリポイント     | accepted   |
| [002](./002-effect-ts-error-handling.md)    | Effect TS によるエラーハンドリング | accepted   |
| [003](./003-post-tool-use-auto-lint.md)     | PostToolUse 自動 lint フック       | accepted   |
