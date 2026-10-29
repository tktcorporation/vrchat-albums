# Worktree / 並列作業ルール

複数の Claude / 人間プロセスが同一リポジトリで並列作業する状況での競合防止と、worktree の運用手順。

## 他プロセスの変更を消さない

自分が書いていない差分は別プロセスの作業である。自分の判断で削除・リバート・上書き・「整理」しない。`git checkout -- .` / `git restore .` / `git reset --hard` / `git clean -f` のような全変更の巻き戻しもしない。

## worktree を切る判断

セッション開始時に `git status` を見て、自分のタスクと無関係な変更があれば worktree を切る。判断がつかなければ安全側に倒して切る。

既存コードを変更しない作業（検索・閲覧・構文チェック・集計の試行、新規ファイルの追加だけ）は、元のチェックアウトのまま行ってよい。worktree の作成・破棄コストの方が大きい。既存コードの変更を伴う作業は worktree で行う。

## 作成場所とベースブランチ

worktree は作業対象の git リポジトリの `.claude/worktrees/` 配下に、origin の default branch から切る。HEAD やトピックブランチから切ると、他の作業の未マージコミットが混入し、CI が無関係なエラーで失敗する。配置は hook で強制されていないので、規約として守る。

`EnterWorktree(name: "タスク名")` を推奨する。`.claude/worktrees/<タスク名>` に作られ、セッション終了時に keep/remove を聞かれる。ただし HEAD ベースで切るため、実行前に下の `git fetch` を行い、HEAD が origin の default branch と一致していることを確認する。

手動で作る場合（サブモジュール内なら先にそのディレクトリへ `cd` する）:

```bash
# default branch 名は repo により main / master 等で異なるため origin/HEAD から導出する。
# origin/HEAD が未設定なら一度だけ: git remote set-head origin --auto
default_branch="$(git symbolic-ref --short refs/remotes/origin/HEAD | sed 's@^origin/@@')"
git fetch origin "$default_branch"
git worktree add .claude/worktrees/<タスク名> -b <ブランチ名> "origin/$default_branch"
```

`.worktrees/` や `/tmp/` 配下には作らない。

作成後、worktree は元のチェックアウトの `node_modules` を共有しない。無ければ依存をインストールしてから作業を始める。

## `.claude/hooks/*.ts` 自体を worktree で変更するとき

`CLAUDE_PROJECT_DIR` は worktree に入っても主チェックアウトを指したままで、`settings.json` の hook コマンドはこの変数経由でスクリプトを呼ぶ。worktree 側のスクリプトを編集しても、そのセッションの hook 実行は主チェックアウト側の古いスクリプトのままになる。動作確認は hook を経由させず、スクリプトを直接 `bun` で実行するか、専用の一時ディレクトリで検証する。

## 他チームが所有するリポジトリの `.gitignore` は触らない

サブモジュールなど自分たちが所有していないリポジトリで worktree を作るとき、その `.gitignore` へ `.claude/worktrees/` を追記しない。所有チームの default branch に、こちらの作業用エントリが紛れ込むためである。`.claude/` が untracked なら追記しなくても worktree は動く（`git status` では `?? .claude/` にまとまる）。自分たちが所有するリポジトリの `.gitignore` は触ってよい。

## 競合を検知したとき

自分が触っていないファイルに変更が入っている、または lint・test の結果が説明できない形で変わった場合は、自分の変更を `git stash push <ファイル>` で退避し、worktree を作って退避した変更を適用し直し、ユーザーに報告する。

## 後始末

PR マージ後や不要になったら `git worktree remove .claude/worktrees/<タスク名>` で削除する。`EnterWorktree` で作った場合は `ExitWorktree` で削除できる。
