# VRChat Albums - Claude Code ガイド

VRChat の写真をログファイルと自動的に関連付けて整理する Electron デスクトップアプリ。

## アーキテクチャ

| レイヤー | パス | 説明 |
|---------|------|------|
| Main Process | `/electron/` | tRPC router (`api.ts`)、ビジネスロジック (`/module/`) |
| Renderer | `/src/v2/` | React コンポーネント、hooks、i18n |

### 技術スタック

- Electron + React 18 + TypeScript + Vite
- tRPC (IPC通信) + SQLite/Sequelize
- Tailwind CSS + Radix UI
- ts-pattern + neverthrow + Zod

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

## ルールファイル（詳細）

| ファイル | 内容 |
|---------|------|
| `.claude/rules/robustness.md` | 堅牢性設計（型による保証、Parse Don't Validate） |
| `.claude/rules/error-handling.md` | エラーハンドリング（neverthrow、try-catch回避） |
| `.claude/rules/ts-pattern.md` | ts-pattern 使用規約（exhaustive checking） |
| `.claude/rules/log-sync.md` | ログ同期（実行順序、データ整合性） |
| `.claude/rules/timezone.md` | タイムゾーン処理（ローカルタイム統一） |
| `.claude/rules/valueobject.md` | ValueObject パターン（型のみエクスポート） |
| `.claude/rules/electron-import.md` | Electron インポート（Playwright互換性） |
| `.claude/rules/testing.md` | テストガイドライン（Vitest、Playwright） |

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
- Service: `Result<T, E>` (neverthrow)
- tRPC: `UserFacingError`
- Frontend: `parseErrorFromTRPC` + Toast

**重要**: 予期されたエラーのみ `Result` でラップ。予期しないエラーは re-throw（Sentry送信のため）。

詳細: `.claude/rules/error-handling.md`

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

## バージョン管理

### Jujutsu（デフォルト）

このプロジェクトでは **jj (Jujutsu)** を colocated mode で使用します。

**ブックマーク形式**: `{type}/{summary}` または `{issue-number}/{type}/{summary}`

Types: `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `perf`, `test`

```bash
# 基本ワークフロー
jj status                    # 状態確認
jj diff                      # 差分表示
jj commit -m "type: message" # コミット
jj bookmark create feat/xxx -r @-  # ブックマーク作成（コミット後）
jj git push --bookmark feat/xxx --allow-new  # プッシュ

# PR作成（git checkout してから gh を使用）
git checkout feat/xxx
gh pr create --title "..." --body "..."
```

**注意**: `jj commit` では pre-commit hooks が実行されません。`pnpm lint && pnpm test` を手動実行するか、CI を信頼してください。

詳細: `docs/jujutsu-workflow.md`、`.claude/rules/jujutsu.md`

### Git（フォールバック）

jj が利用できない環境では Git を使用：

```bash
git checkout -b feat/xxx
git commit -m "type: message"
git push -u origin feat/xxx
```

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
- GritQL: `.grit/patterns/*.md`

※ ESLint は使わない（Biome 移行済み）
