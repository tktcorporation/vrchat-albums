# Jujutsu (jj) ワークフローガイド

このドキュメントは Jujutsu を使用したい開発者向けのガイドです。
Git との colocated mode で動作するため、チームメンバーは引き続き Git を使用できます。

---

## インストール

### macOS

```bash
brew install jj
```

### Windows

```bash
winget install jj
# または
scoop install jujutsu
```

### Linux

```bash
# Cargo
cargo install --locked jujutsu-cli

# Arch Linux
pacman -S jujutsu
```

詳細: https://jj-vcs.github.io/jj/latest/install-and-setup/

---

## 初期設定

### リポジトリの初期化（colocated mode）

```bash
# 既存の Git リポジトリで実行
jj git init --colocate
```

これにより `.jj/` ディレクトリが作成され、`.git/` と共存します。

### ユーザー設定

```bash
jj config set --user user.name "Your Name"
jj config set --user user.email "your.email@example.com"
```

---

## 基本コマンド（Git との対応表）

| Git | Jujutsu | 説明 |
|-----|---------|------|
| `git status` | `jj status` / `jj st` | 作業状態の確認 |
| `git diff` | `jj diff` | 差分表示 |
| `git log` | `jj log` | 履歴表示 |
| `git add` | （自動） | jj は自動的に変更を追跡 |
| `git commit` | `jj commit -m "..."` | コミット作成 |
| `git branch` | `jj bookmark list` | ブランチ一覧 |
| `git checkout -b` | `jj bookmark create` | ブランチ作成 |
| `git push` | `jj git push` | リモートへプッシュ |
| `git pull` | `jj git fetch` | リモートから取得 |
| `git rebase -i` | `jj rebase` | リベース |

---

## 日常的なワークフロー

### 1. 変更の確認

```bash
# 現在の状態を確認
jj status

# 差分を確認
jj diff

# 履歴を確認
jj log
```

### 2. コミットの作成

```bash
# 現在の変更をコミット
jj commit -m "feat: add new feature"

# 説明付きでコミット
jj commit -m "fix: resolve issue" -m "詳細な説明をここに記述"
```

### 3. ブランチ（ブックマーク）の操作

```bash
# ブランチを作成（プロジェクトの命名規則に従う）
jj bookmark create 123/feat/add-user-search

# ブランチを移動
jj bookmark set 123/feat/add-user-search

# ブランチ一覧
jj bookmark list

# ブランチを削除
jj bookmark delete old-branch
```

### 4. リモートとの同期

```bash
# リモートから取得
jj git fetch

# プッシュ
jj git push

# 特定のブックマークをプッシュ
jj git push --bookmark 123/feat/add-user-search
```

---

## コンフリクト解決

jj はコンフリクトを特別なコミットとして記録します。

```bash
# コンフリクトの確認
jj log  # コンフリクトのあるコミットには 'conflict' マークが表示される

# コンフリクトを解決
jj resolve

# 解決後、コミットを修正
jj squash
```

---

## 便利な機能

### 作業の一時保存（Git stash 相当）

```bash
# 新しい空のコミットを作成して、そこに移動
jj new

# 戻りたい場合
jj edit @-
```

### コミットの修正

```bash
# 直前のコミットを修正
jj squash

# 特定のコミットを編集
jj edit <commit-id>
```

### 履歴の書き換え

```bash
# リベース
jj rebase -d main

# 複数のコミットをまとめる
jj squash
```

---

## GitHub PR との連携

### PR の作成

```bash
# ブックマークを作成してプッシュ
jj bookmark create 123/feat/my-feature
jj git push --bookmark 123/feat/my-feature

# GitHub で PR を作成
gh pr create
```

### PR の更新

```bash
# 変更を加えてコミット
jj commit -m "address review comments"

# プッシュ
jj git push
```

---

## トラブルシューティング

### Git との同期がずれた場合

```bash
# Git の状態を jj に反映
jj git import

# jj の状態を Git に反映
jj git export
```

### 変更を破棄したい場合

```bash
# 現在の変更を破棄
jj restore

# 特定のコミットに戻る
jj edit <commit-id>
```

### jj の状態をリセットしたい場合

```bash
# .jj/ を削除して再初期化
rm -rf .jj
jj git init --colocate
```

---

## 注意事項

### Pre-commit hooks について

**重要**: `jj commit` は Git の pre-commit hooks を実行しません。

このプロジェクトでは CI が最終的なチェックを行うため、プッシュ前に手動で確認することを推奨します：

```bash
pnpm lint:fix
pnpm lint
pnpm test
```

### Git コマンドとの併用

colocated mode では Git コマンドも使用できますが、混在させると混乱の原因になることがあります。
どちらか一方を主に使用することを推奨します。

---

## 参考リンク

- [Jujutsu 公式ドキュメント](https://jj-vcs.github.io/jj/latest/)
- [Jujutsu Tutorial](https://jj-vcs.github.io/jj/latest/tutorial/)
- [Git との比較](https://jj-vcs.github.io/jj/latest/git-comparison/)
