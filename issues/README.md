# Linter化候補メモ

このディレクトリには、CLAUDE.mdに記載された規約のうち、将来的にlinterとして実装すべきものを記録します。

## ファイル命名規則

`{YYYYMMDD}-{short-description}.md`

例: `20251227-ts-pattern-if-replacement.md`

## テンプレート

```markdown
# Linter化候補: {タイトル}

## 現状の規約
（CLAUDE.mdからの引用）

## なぜLinter化すべきか
- 理由1
- 理由2

## 実装案
以下のいずれかを選択:

### 1. TypeScript Compiler API (`scripts/lint-*.ts`)
型情報が必要な複雑なチェック向け
```bash
pnpm tsx scripts/lint-{name}.ts
```
参考: `scripts/lint-valueobjects.ts`, `scripts/lint-neverthrow.ts`

### 2. GritQL (`.grit/patterns/*.md`)
シンプルなパターンマッチング向け
```bash
grit apply {pattern_name} {target_path} --dry-run
```
参考: `.grit/patterns/neverthrow_catch.md`

### 選択基準
- 型情報が必要 → TypeScript Compiler API
- 単純な構文パターン検出 → GritQL
- ESLintは使わない（Biome移行済み）

## 優先度
高 / 中 / 低

## 関連する既存のlinter
- pnpm lint:neverthrow
- pnpm lint:valueobjects
```

## いつ記録すべきか

- 規約違反を手動でチェックしている場合
- 同じ指摘を複数回している場合
- 自動検出が技術的に可能な場合
