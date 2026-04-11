---
name: block-revert-others
enabled: true
event: bash
pattern: (git\s+checkout\s+--\s+\.|git\s+restore\s+\.|git\s+reset\s+--hard|git\s+clean\s+-[a-z]*f|jj\s+restore\s+(--from|--to|--changes-in))
action: block
---

🚫 **他プロセスの変更を巻き込む可能性のあるコマンドがブロックされました**

並列作業中に以下のコマンドを実行すると、別プロセスの作業成果が失われます:

- `git checkout -- .` — 全ファイルの変更を破棄
- `git restore .` — 全ファイルの変更を破棄
- `git reset --hard` — コミット含め全変更を破棄
- `git clean -f` — 未追跡ファイルを削除
- `jj restore --from/--to/--changes-in` — チェンジの巻き戻し（他の変更を巻き込む）

**代わりに以下の安全な方法を使ってください:**

1. 特定ファイルのみを対象にする（`git checkout -- <specific-file>`）
2. 自分の変更だけを退避する（`jj shelve` / `git stash push <specific-files>`）
3. ワークスペースを作成して独立した環境で作業する（`jj workspace add` / `git worktree add`）
4. 判断がつかない場合はユーザーに確認する
