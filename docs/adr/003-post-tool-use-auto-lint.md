# ADR-003: PostToolUse 自動 lint フック

- **ステータス**: accepted
- **日付**: 2026-04-14
- **関連フック**: `.claude/hooks/post-edit-lint.sh`

## コンテキスト

エージェントがコードを書いた後、lint 違反に気付くのは通常 CI（分単位）か手動実行（秒〜分）のタイミングだった。修正サイクルが遅く、lint 違反が積み上がってから一括修正するパターンが発生していた。

## 決定

Write/Edit/MultiEdit の PostToolUse フックで oxfmt（自動フォーマット）と oxlint（静的解析）を即時実行する。結果は `hookSpecificOutput.additionalContext` の JSON 形式でエージェントにフィードバックする。

## 根拠

- フィードバック速度: PostToolUse（ミリ秒）>> Pre-commit（秒）>> CI（分）
- 自動修正: oxfmt はフォーマットを自動適用、エージェントの手間を削減
- JSON フィードバック: エージェントが構造化された情報として受け取り、次のアクションで即修正可能
- 参考: Harness Engineering Best Practices (2026)

## 結果

- 全 TS/TSX ファイルの編集時に自動実行
- フォーマット違反は自動修正（oxfmt --write）
- 静的解析違反はエージェントに通知（手動修正）
