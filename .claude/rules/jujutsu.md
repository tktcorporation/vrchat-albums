# Jujutsu (jj) 使用規約

Claude Code が Jujutsu を使用する際のガイドライン。

---

## 概要

このプロジェクトでは Jujutsu を **colocated mode** で使用できます。
`.git/` と `.jj/` が共存し、Git と jj どちらのコマンドも使用可能です。

---

## 基本原則

1. **ユーザーの選択を尊重**: ユーザーが jj を使用している場合は jj コマンドを使用
2. **デフォルトは Git**: 明示的な指示がない場合は Git コマンドを使用
3. **CI が safety net**: pre-commit hooks は jj では実行されないため、CI を信頼

---

## jj 使用時のコミット手順

### 1. 変更の確認

```bash
jj status
jj diff
```

### 2. コミットの作成

```bash
jj commit -m "$(cat <<'EOF'
feat: add new feature

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

### 3. ブックマーク（ブランチ）の作成

```bash
# プロジェクトの命名規則に従う
jj bookmark create {issue-number}/{type}/{summary}
# 例: jj bookmark create 123/feat/add-user-search
```

### 4. プッシュ

```bash
jj git push --bookmark {bookmark-name}
```

---

## 重要な注意点

### Pre-commit hooks は実行されない

**`jj commit` は Git の pre-commit hooks を実行しません。**

- simple-git-hooks で設定された lint/test は実行されない
- CI が最終チェックを行う
- 必要に応じて手動で `yarn lint:fix && yarn lint && yarn test` を実行

### colocated mode の動作

| 操作 | 結果 |
|------|------|
| `jj commit` | `.jj/` と `.git/` の両方が更新される |
| `git commit` | `.git/` のみ更新、`jj git import` で同期 |
| `jj git push` | Git の remote にプッシュ |

---

## コマンド対応表

| 操作 | Git | Jujutsu |
|------|-----|---------|
| 状態確認 | `git status` | `jj status` |
| 差分表示 | `git diff` | `jj diff` |
| コミット | `git commit -m "..."` | `jj commit -m "..."` |
| ブランチ作成 | `git checkout -b name` | `jj bookmark create name` |
| プッシュ | `git push` | `jj git push` |
| プル | `git pull` | `jj git fetch` |

---

## PR 作成時の手順

```bash
# 1. ブックマークを作成
jj bookmark create 123/feat/my-feature

# 2. プッシュ
jj git push --bookmark 123/feat/my-feature

# 3. PR 作成（gh CLI を使用）
gh pr create --title "feat: ..." --body "..."
```

---

## トラブルシューティング

### Git と jj の状態がずれた場合

```bash
# Git → jj に同期
jj git import

# jj → Git に同期
jj git export
```

### jj が初期化されていない場合

```bash
jj git init --colocate
```

---

## 関連ドキュメント

- `docs/jujutsu-workflow.md` - 詳細なワークフローガイド
- `CLAUDE.md` - プロジェクト全体のガイド
