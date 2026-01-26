# GritQL Linter移行ガイド

## 概要

カスタムlintツール（lint-valueobjects.ts、lint-neverthrow.ts）をGritQLベースの実装に移行することで、以下の問題を解決します：

- **Windows環境での互換性問題の解消**
- **テストの簡素化（ファイルI/O不要）**
- **保守性の向上（宣言的なパターン定義）**

## 現在の実装状況

### ✅ 完了した作業

1. **GritQL環境のセットアップ**
   - GritQL CLIツールのインストール完了
   - `.grit/`ディレクトリ構造の作成

2. **ValueObjectパターンの実装**
   - `valueobject_export.md`: クラスエクスポートチェック
   - 既存テストケースで動作確認済み

3. **CI/CD統合**
   - package.jsonにGritQLコマンドを追加
   - 既存linterと並行実行可能

### 📋 移行計画

#### Phase 1: パイロット運用（現在）
- ValueObjectルールをGritQLで実装 ✅
- 既存TypeScriptベースのlinterと並行運用
- 両方の結果を比較して精度を確認

#### Phase 2: 段階的移行（次のステップ）
1. neverthrowルールのGritQL実装
2. より複雑なパターンの移行
3. テストカバレッジの拡充

#### Phase 3: 完全移行
- TypeScriptベースのlinterを廃止
- GritQLのみに統一

## セットアップ

### インストール方法

このプロジェクトではmiseを使用してGritQLを管理しています：

```bash
# miseを使用して自動インストール（推奨）
mise install

# または手動でインストール
npm install -g @getgrit/cli
```

miseの設定は`.mise.toml`で管理されており、`npm:@getgrit/cli`として定義されています。これにより、チーム全体で同じバージョンのGritQLを使用できます。

## 使用方法

### 基本コマンド

```bash
# GritQLパターンのチェック
grit check

# 特定パターンの適用（dry-run）
grit apply valueobject_export --dry-run

# パターンのテスト実行
grit patterns test

# npmスクリプト経由での実行
pnpm lint:grit
pnpm lint:valueobjects:grit
```

### パターンファイルの追加方法

1. `.grit/patterns/`にMarkdownファイルを作成
2. ファイル名がパターン名になる（ハイフン不可、アンダースコア使用）
3. 以下の形式で記述：

```markdown
---
title: Pattern Title
---

# Pattern Description

\`\`\`grit
language js

// GritQLパターン
\`export class $name extends BaseClass\`
\`\`\`

## Test cases

### ❌ Bad example
\`\`\`js
// マッチするコード
export class Foo extends BaseClass {}
\`\`\`

### ✅ Good example
\`\`\`js
// マッチしないコード
class Foo extends BaseClass {}
export type { Foo };
\`\`\`
```

## 利点

### 1. クロスプラットフォーム対応
- Rust製でOS非依存
- Windows環境での問題が完全に解消

### 2. テストの簡素化
- Markdownファイル内にテストケースを記述
- ファイルI/O不要で高速実行
- `grit patterns test`で一括テスト

### 3. 保守性の向上
- 宣言的なパターン定義
- TypeScript ASTの詳細知識不要
- パターンとテストが同じファイルで管理

### 4. パフォーマンス
- Rust実装で高速
- 並列処理対応
- 大規模コードベースでも効率的

## 既知の問題と対策

### 問題1: 一部のTypeScriptファイルでパースエラー
**症状**: `ERROR (code: 300) - Error parsing source code`
**対策**: 複雑なTypeScript構文は段階的に対応

### 問題2: パターン名にハイフン使用不可
**症状**: `Invalid pattern name`
**対策**: アンダースコアを使用（例：`valueobject_export.md`）

## 今後の課題

1. **neverthrowルールの完全移行**
   - catch-errアンチパターンの検出
   - Result型の強制チェック

2. **IDE統合**
   - VSCode拡張機能の導入
   - リアルタイムフィードバック

3. **カスタムルールの拡充**
   - プロジェクト固有のパターン追加
   - チーム共有のベストプラクティス

## リファレンス

- [GritQL公式ドキュメント](https://docs.grit.io/)
- [GritQL Playground](https://app.grit.io/studio)
- [Tree-sitter TypeScript Grammar](https://github.com/tree-sitter/tree-sitter-typescript)

## サポート

問題が発生した場合：
1. `grit patterns test`でパターンの動作確認
2. `--dry-run`オプションで安全に実行
3. GitHubイシューで報告