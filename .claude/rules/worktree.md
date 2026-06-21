## 作成場所（CRITICAL — hook で強制）

**Worktree は必ず、作業対象の git リポジトリの `.claude/worktrees/` 配下に作成すること。**

### 推奨: `EnterWorktree` ツールを使う

```
EnterWorktree(name: "タスク名")
```

- `.claude/worktrees/<タスク名>` に自動作成される
- セッション終了時に keep/remove を聞いてくれるので掃除忘れを防げる
- **ただし HEAD ベースで切るため、事前に default branch を fetch して、その上にいることを確認する**

### デフォルトブランチの取得（main / master をハードコードしない）

リポジトリによって default branch は `main`・`master` 等まちまちなので、固定値を書かず origin から動的に導出する:

```bash
# origin のデフォルトブランチ名を取得（どのリポジトリでも動く）
DEFAULT_BRANCH="$(git remote show origin | sed -n 's/.*HEAD branch: //p')"
# ローカルキャッシュから取りたい場合（ネットワーク不要、未設定なら set-head で補う）:
#   git remote set-head origin --auto >/dev/null 2>&1
#   DEFAULT_BRANCH="$(git symbolic-ref --short refs/remotes/origin/HEAD | sed 's@^origin/@@')"
```

以降のコマンドはこの `$DEFAULT_BRANCH` を使う。

### 手動で作る場合

```bash
# プロジェクトルートで作業する場合
DEFAULT_BRANCH="$(git remote show origin | sed -n 's/.*HEAD branch: //p')"
git fetch origin "$DEFAULT_BRANCH"
git worktree add .claude/worktrees/<タスク名> -b <ブランチ名> "origin/$DEFAULT_BRANCH"

# サブモジュール内で作業する場合
cd <サブモジュールのパス>
DEFAULT_BRANCH="$(git remote show origin | sed -n 's/.*HEAD branch: //p')"
git fetch origin "$DEFAULT_BRANCH"
git worktree add .claude/worktrees/<タスク名> -b <ブランチ名> "origin/$DEFAULT_BRANCH"
```

```bash
# 間違い（hook でブロックされる）
git worktree add .worktrees/<タスク名> ...
git worktree add /tmp/<タスク名> ...
```

## ベースブランチ（CRITICAL）

**Worktree は必ず origin の default branch から切ること。** ブランチ名は上記のとおり動的に導出し、`main`/`master` を決め打ちしない。

```bash
DEFAULT_BRANCH="$(git remote show origin | sed -n 's/.*HEAD branch: //p')"
git fetch origin "$DEFAULT_BRANCH"
```

HEAD やトピックブランチから切ると、他の作業の未マージコミットが混入し、CI が無関係なエラーで失敗する。

`EnterWorktree` は HEAD ベースで切るため、実行前に必ず以下を確認すること:

1. `git fetch origin "$DEFAULT_BRANCH"` でリモートを最新にする
2. 現在の HEAD が `origin/$DEFAULT_BRANCH` と同じであること（サブモジュールの場合は `cd` してから）

## サブモジュールでの `.gitignore`

サブモジュール内で worktree を作る場合、そのリポジトリの `.gitignore` に `.claude/worktrees/` が含まれていることを確認する。
なければ追加してからworktreeを作成すること。

## 後始末

PR マージ後 or 不要になったら速やかに削除する:

```bash
git worktree remove .claude/worktrees/<タスク名>
```

`EnterWorktree` で作った場合は `ExitWorktree` で削除できる。
