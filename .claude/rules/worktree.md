# Worktree / 並列作業ルール

複数の Claude / 人間プロセスが同一リポジトリで並列作業する状況での競合防止と、worktree の運用手順。

## 最重要: 他プロセスの変更を絶対に消さない

他の Claude プロセスや人間が行った変更を、自分の判断で削除・リバート・上書きしてはならない。自分が書いていない差分は別プロセスの作業。

## セッション開始時のチェック

1. `git status` で未コミットの変更を確認
2. 自分のタスクと無関係な変更が存在 → worktree を切って作業開始
3. 判断がつかない → worktree を切る（安全側に倒す）

## 作成場所（CRITICAL）

**Worktree は必ず、作業対象の git リポジトリの `.claude/worktrees/` 配下に作成すること。** この配置は hook では強制されておらず、Automode とレビューで守る規約になる。

### 推奨: `EnterWorktree` ツールを使う

```text
EnterWorktree(name: "タスク名")
```

- `.claude/worktrees/<タスク名>` に自動作成される
- セッション終了時に keep/remove を聞いてくれるので掃除忘れを防げる
- **ただし HEAD ベースで切るため、事前に origin の default branch を fetch し、その上にいることを確認する（コマンドは下の「手動で作る場合」を参照）**

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
# default branch 名は repo により main / master 等で異なるため origin/HEAD から動的に取得する。
# origin/HEAD が未設定なら一度だけ: git remote set-head origin --auto
default_branch="$(git symbolic-ref --short refs/remotes/origin/HEAD | sed 's@^origin/@@')"

# プロジェクトルートで作業する場合
git fetch origin "$default_branch"
git worktree add .claude/worktrees/<タスク名> -b <ブランチ名> "origin/$default_branch"

# サブモジュール内で作業する場合
cd <サブモジュールのパス>
default_branch="$(git symbolic-ref --short refs/remotes/origin/HEAD | sed 's@^origin/@@')"
git fetch origin "$default_branch"
git worktree add .claude/worktrees/<タスク名> -b <ブランチ名> "origin/$default_branch"
```

```bash
# 間違い（このルールに反する）
git worktree add .worktrees/<タスク名> ...
git worktree add /tmp/<タスク名> ...
```

## ベースブランチ（CRITICAL）

**Worktree は必ず origin の default branch（repo により `main` / `master` 等）から切ること。** ブランチ名はハードコードせず、`origin/HEAD` から動的に導出する。

```bash
default_branch="$(git symbolic-ref --short refs/remotes/origin/HEAD | sed 's@^origin/@@')"
git fetch origin "$default_branch"
```

HEAD やトピックブランチから切ると、他の作業の未マージコミットが混入し、CI が無関係なエラーで失敗する。

`EnterWorktree` は HEAD ベースで切るため、実行前に必ず以下を確認すること:

1. `default_branch` を導出して `git fetch origin "$default_branch"` でリモートを最新にする
2. 現在の HEAD が origin の default branch と同じであること（サブモジュールの場合は `cd` してから）

## 作成後の依存インストール

worktree は元のチェックアウトの `node_modules` を共有しない。作成後に無ければ依存をインストールしてから作業を始める。

## `.claude/hooks/*.ts` 自体を worktree で変更するとき

`CLAUDE_PROJECT_DIR` は worktree に入っても主チェックアウトを指したままで、`settings.json` の hook コマンドはこの変数経由でスクリプトを呼ぶ。worktree 側のスクリプトを編集しても、そのセッションの hook 実行は主チェックアウト側の古いスクリプトのままになる。動作確認は hook を経由させず、スクリプトを直接 `bun` で実行するか、専用の一時ディレクトリで検証する。変更が主チェックアウトの `.claude/hooks/` に反映される（マージ後）まで、そのセッションの hook 実行には現れない。

## 他チームが所有するリポジトリの `.gitignore` は触らない

サブモジュールなど、自分たちが所有していないリポジトリの中で worktree を作るとき、その `.gitignore` へ `.claude/worktrees/` を追記したくなる。**追記してはいけない。** 所有チームの default branch に、こちらの作業用エントリが紛れ込み、PR レビューで紛らわしくなる。

- `.claude/` がそのリポジトリで untracked 扱いなら、追記しなくても worktree は動く（`git status` では `?? .claude/` にまとまる）。
- そのリポジトリの `.claude/worktrees/<name>` に worktree を作ること自体は可。
- 自分たちが所有するリポジトリの `.gitignore` は対象外で、こちらは触ってよい。

## worktree が必須でない作業

既存コードを変更しない作業は、元のチェックアウトのまま行ってよい。worktree の作成・破棄コストの方が大きい。

- 読み取りだけの作業（検索・閲覧・構文チェック・集計の試行）→ そのまま
- 新規ファイルの追加のみ（新しいクエリ・ドキュメント）→ そのまま
- **既存コードの変更を伴う作業（アプリケーションロジックの修正、画面の編集など）→ 依然として worktree を作る**
- 判断がつかない場合は安全側に倒して worktree を作る

## 競合検知時の対応

自分が触っていないファイルに変更が入っている / lint・test 結果が説明できない形で変わった場合:

1. 自分の変更を `git stash push <ファイル>` で退避
2. worktree を作成
3. 退避した変更を適用して作業再開
4. ユーザーに報告

## 後始末

PR マージ後 or 不要になったら速やかに削除する:

```bash
git worktree remove .claude/worktrees/<タスク名>
```

`EnterWorktree` で作った場合は `ExitWorktree` で削除できる。

## 禁止事項

- 他プロセスの変更の削除・リバート・「修正」「整理」
- `git checkout -- .` / `git restore .` / `git reset --hard` / `git clean -f` での全変更巻き戻し
- 競合を無視した上書き
