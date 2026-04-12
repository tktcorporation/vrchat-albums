# 並列作業ルール（競合防止）

複数の Claude Code プロセスが同一リポジトリで同時に作業する場合の必須ルール。

## 最重要: 他プロセスの変更を絶対に消さない

他の Claude プロセスや人間が行った変更を、自分の判断で削除・リバート・上書きしてはならない。自分が書いていない差分は別プロセスの作業。

## セッション開始時

1. `git status` で未コミットの変更を確認
2. 自分のタスクと無関係な変更が存在 → ワークスペースを切って作業開始
3. 判断がつかない → ワークスペースを切る（安全側に倒す）

## Worktree 運用

**必ず `.claude/worktrees/` 配下に作成**（hook で強制）。**必ず `origin/main` から切る**（未マージコミット混入防止）。

```bash
# 推奨
git fetch origin main
EnterWorktree(name: "タスク名")

# 手動
git fetch origin main
git worktree add .claude/worktrees/<タスク名> -b <ブランチ名> origin/main
```

- 作成後 `node_modules` がなければ `pnpm install` を実行
- PR マージ後 → `git worktree remove .claude/worktrees/<タスク名>` で削除

## 競合検知時

自分が触っていないファイルに変更が入っている / lint・test結果が説明できない形で変わった場合:

1. 自分の変更を `git stash push <ファイル>` で退避
2. ワークスペースを作成
3. 退避した変更を適用して作業再開
4. ユーザーに報告

## 禁止事項

- 他プロセスの変更の削除・リバート・「修正」「整理」
- `git checkout -- .` / `git restore .` / `git reset --hard` / `git clean -f` での全変更巻き戻し
- 競合を無視した上書き
