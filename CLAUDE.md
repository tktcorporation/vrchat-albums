# VRChat Albums

VRChat 写真をログファイルと自動関連付けする Electron デスクトップアプリ。

## コマンド

| タスク           | コマンド                            |
| ---------------- | ----------------------------------- |
| lint (自動修正)  | `pnpm lint:fix`                     |
| lint             | `pnpm lint`                         |
| test             | `pnpm test`                         |
| build            | `pnpm build`                        |
| 未使用コード検出 | `pnpm knip --config knip.config.ts` |

**タスク完了順序**: 実装 → `pnpm lint:fix` → `pnpm lint` → `pnpm test`

## パス

| レイヤー     | パス              |
| ------------ | ----------------- |
| Main Process | `electron/`       |
| Renderer     | `src/v2/`         |
| tRPC Router  | `electron/api.ts` |

## 禁止

- npm 使用禁止（pnpm 10+ のみ）
- 自動生成ファイルの変更禁止: `src/assets/licenses.json`, `pnpm-lock.yaml`, `CHANGELOG.md`
- ESLint 使用禁止（oxlint + oxfmt 移行済み）
- ログ同期の個別関数呼び出し禁止 → `useLogSync` / `syncLogs()` のみ (ADR-001)
- 色の直接指定禁止 → セマンティックトークン使用 (`src/v2/constants/ui.ts`)
- try-catch 禁止 → Effect TS 使用 (ADR-002)
- テキストハードコード禁止 → `t()` 関数経由

## ルール (`.claude/rules/`)

規約の詳細は個別ルールファイルを参照。CLAUDE.md に説明を複製しない。

## Linter 改善トラッキング

規約の Linter 化候補は `./issues/` に記録。実装: `scripts/lint-*.ts` / `rules/ast-grep/*.yml`

## ADR

設計判断の根拠は `docs/adr/` に記録。禁止事項には ADR 番号を付与。
