# Worktree ルール

## 作成場所（CRITICAL — hook で強制）

**Worktree は必ず、作業対象の git リポジトリの `.claude/worktrees/` 配下に作成すること。**

### 推奨: `EnterWorktree` ツールを使う

```
EnterWorktree(name: "タスク名")
```

- `.claude/worktrees/<タスク名>` に自動作成される
- セッション終了時に keep/remove を聞いてくれるので掃除忘れを防げる
- **ただし HEAD ベースで切るため、事前に `git fetch origin master` して origin/master 上にいることを確認する**

### 手動で作る場合

```bash
# プロジェクトルートで作業する場合
git fetch origin master
git worktree add .claude/worktrees/<タスク名> -b <ブランチ名> origin/master

# サブモジュール内で作業する場合
cd <サブモジュールのパス>
git fetch origin master
git worktree add .claude/worktrees/<タスク名> -b <ブランチ名> origin/master
```

```bash
# 間違い（hook でブロックされる）
git worktree add .worktrees/<タスク名> ...
git worktree add /tmp/<タスク名> ...
```

## ベースブランチ（CRITICAL）

**Worktree は必ず origin の default branch（`main` / `master`）から切ること。**

```bash
git fetch origin master
```

HEAD やトピックブランチから切ると、他の作業の未マージコミットが混入し、CI が無関係なエラーで失敗する。

`EnterWorktree` は HEAD ベースで切るため、実行前に必ず以下を確認すること:

1. `git fetch origin master` でリモートを最新にする
2. 現在の HEAD が origin/master と同じであること（サブモジュールの場合は `cd` してから）

## サブモジュールでの `.gitignore`

サブモジュール内で worktree を作る場合、そのリポジトリの `.gitignore` に `.claude/worktrees/` が含まれていることを確認する。
なければ追加してからworktreeを作成すること。

## 後始末

PR マージ後 or 不要になったら速やかに削除する:

```bash
git worktree remove .claude/worktrees/<タスク名>
```

`EnterWorktree` で作った場合は `ExitWorktree` で削除できる。
