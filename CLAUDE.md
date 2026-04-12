# VRChat Albums - Claude Code ガイド

VRChat の写真をログファイルと自動的に関連付けて整理する Electron デスクトップアプリ。

## アーキテクチャ

| レイヤー     | パス         | 説明                                                  |
| ------------ | ------------ | ----------------------------------------------------- |
| Main Process | `/electron/` | tRPC router (`api.ts`)、ビジネスロジック (`/module/`) |
| Renderer     | `/src/v2/`   | React コンポーネント、hooks、i18n                     |

### 技術スタック

- Electron + React 18 + TypeScript + Vite
- tRPC (IPC通信) + SQLite/Sequelize
- Tailwind CSS + Radix UI
- ts-pattern + Effect TS + Zod

## 環境

- **Node.js**: 22 LTS
- **パッケージマネージャ**: pnpm 10+ (npm禁止)

## タスク完了プロセス

```text
1. Code Implementation
2. pnpm lint:fix
3. pnpm lint
4. pnpm test
5. Task Completion
```

---

## ルールファイル

### 汎用ルール（`.claude/rules/`）

| ファイル                       | 内容                                                   |
| ------------------------------ | ------------------------------------------------------ |
| `robustness.md`                | 堅牢性設計 + ts-pattern（型保証、exhaustive checking） |
| `error-handling.md`            | Effect TS エラーハンドリング（try-catch回避）          |
| `parallel-work.md`             | 並列作業・Worktree 運用（競合防止）                    |
| `code-intent-documentation.md` | コメント・JSDoc（WHYを残す）                           |
| `codex-pairing.md`             | Codex CLI セカンドオピニオン                           |
| `ci-workflow.md`               | CI/PR ワークフロー（`paths` 制限あり）                 |

### プロジェクト固有ルール（`.claude/rules/project/`）

| ファイル             | 条件（`paths`）                               | 内容                               |
| -------------------- | --------------------------------------------- | ---------------------------------- |
| `log-sync.md`        | 常時 **CRITICAL**                             | ログ同期（実行順序、データ整合性） |
| `ui-ux-design.md`    | `src/**/*.tsx`, `src/**/*.css`, `src/v2/**/*` | UI/UXデザイン                      |
| `testing.md`         | `**/*.test.ts`, `**/*.spec.ts`, `e2e/**/*`    | テストガイドライン                 |
| `electron-import.md` | `electron/**/*`                               | Electron インポート規約            |
| `timezone.md`        | `electron/module/vrchatLog/**/*` 等           | タイムゾーン処理                   |
| `valueobject.md`     | `electron/lib/valueObject/**/*` 等            | ValueObject パターン               |

---

## クリティカルガイドライン（概要）

### ログ同期（データ整合性必須）

**実行順序**: `appendLoglines → loadLogInfo → cache invalidation`

- ✅ 許可: `useLogSync` hook / `syncLogs()` service
- ❌ 禁止: 個別関数の直接呼び出し

詳細: `.claude/rules/log-sync.md`

### 堅牢性設計

**優先順位**: 型による保証 > 静的解析 > ランタイム検証 > テスト

**必須ツール**:

- ts-pattern: 条件分岐・exhaustive checking
- Zod: 外部境界のバリデーション
- neverthrow: 予期されたエラーの型安全な伝播

詳細: `.claude/rules/robustness.md`

### エラーハンドリング

**レイヤー構造**:

- Service: `Effect.Effect<T, E>` (Effect TS)
- tRPC: `UserFacingError`（`runEffectForTRPC()` で変換）
- Frontend: `parseErrorFromTRPC` + Toast

**重要**: 予期されたエラーのみ `Effect.fail()` でラップ。予期しないエラーは re-throw（Sentry送信のため）。

詳細: `.claude/rules/error-handling.md`

### UI/UXデザイン

**原則**: 引き算のデザイン。コンテンツ（写真）が主役、UIクロームは最小限。

**必須プロセス**:

1. 既存コンポーネント（`src/components/ui/`）の調査 → 再利用優先
2. デザイントークン（`src/v2/constants/ui.ts`）の使用 → 色・サイズの直接指定禁止
3. 最小構成での設計 → 「削除しても機能するか」テスト

**禁止事項**:

- 色の直接指定（`bg-blue-500` 等）→ セマンティックトークン使用
- 過剰な装飾（グラデーションテキスト、多重シャドウ、常時アニメーション）
- 既存コンポーネントの再発明
- テキストのハードコード → `t()` 関数経由

詳細: `.claude/rules/ui-ux-design.md`

---

## アーキテクチャパターン（概要）

### tRPC 通信

Main-Renderer 間の通信はすべて `electron/api.ts` の tRPC router 経由。

### データベースアクセス

- Models: `/electron/module/*/model.ts`
- Services: Result 型でラップ
- 同時書き込み: DB queue システムで防止

### 写真処理

- EXIF: exiftool-vendored
- サムネイル: sharp
- 関連付け: ログファイルのタイムスタンプベース

---

## 自動生成ファイル（変更禁止）

- `src/assets/licenses.json`
- `pnpm-lock.yaml`
- `CHANGELOG.md`

---

## Linter 改善トラッキング

規約の Linter 化候補は `./issues/` に記録。

**実装オプション**:

- TypeScript Compiler API: `scripts/lint-*.ts`
- ast-grep: `rules/ast-grep/*.yml`

※ ESLint は使わない（oxlint + oxfmt 移行済み）
