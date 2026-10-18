# Cloudでのレビュー付きDraft PR作成

`functions.exec` でツールを呼び出すクラウド環境では、リポジトリの `PreToolUse` フックが自動適用されるとは限らない。PR作成には `.codex/create-reviewed-pr.cjs` を使う。このラッパーは共有レビュー判定を実行してからGitHubコネクタを呼ぶ。チェックを単独実行した後、コネクタを直接呼ぶ手順にはしない。

## レビューを終えて記録する

`.claude/skills/pr-review-loop/SKILL.md` に従い、独立レビュー、修正、コミット、再レビューを収束まで回す。Codex CLIが使えない場合の代替条件は `.claude/rules/pr-self-review.md` に従う。フックやラッパー自体がレビューを行うわけではない。

最終レビューでは、取得した最新baseとHEADをレビュアーへ明示する。結果をテキストファイルへ保存し、最終ラウンドの記録に添える。

```bash
# 既定ブランチ名はリポジトリごとに異なるため origin/HEAD から導く。
# クラウドの clone では origin/HEAD が未設定のことがあるので、先にリモートから設定する。
git remote set-head origin --auto
default_branch="$(git symbolic-ref --short refs/remotes/origin/HEAD | sed 's@^origin/@@')"
git fetch origin "$default_branch"
git rev-parse HEAD "origin/$default_branch"
# この2つのSHAの差分を独立レビュアーが確認した後に実行する。
bun .claude/hooks/record-pr-review.ts 0 codex --base "origin/$default_branch" --evidence /tmp/final-review.txt
```

件数・`accepted`・`codex` は実際の結果と既存ルールに従う。例の0を結果を確認せず記録しない。保存される証跡はbase/head、レポート本文とハッシュ、ラウンド記録のハッシュであり、独立実行を認証する署名ではない。

必要なテストを実行し、最新baseとの実マージ結果を確認する。変更ブランチだけをpushしてから作成する。HEADやbaseが変わった場合は、新しい差分をレビューし直して証跡を記録する。

## functions.execから作成する

以下の `cwd`・SHA・base ブランチ名・本文・コネクタ名は実際の作業対象に合わせる。BunがPATHに無い場合は、`bun` に確認済みの実行ファイルの絶対パスを渡す。ソースはレビューした作業ツリーから読み込む。

```javascript
const cwd = '/workspace/repository/worktree';
const source = await tools.exec_command({
  cmd: 'cat .codex/create-reviewed-pr.cjs',
  workdir: cwd,
  max_output_tokens: 12000,
});
if (source.exit_code !== 0 || source.session_id !== undefined)
  throw new Error('Cannot load PR harness');
const module = { exports: null };
new Function('module', source.output)(module);
const result = await module.exports(
  {
    exec: tools.exec_command,
    poll: tools.write_stdin,
    create: tools.mcp__codex_apps__github_create_pull_request,
  },
  {
    cwd,
    bun: 'bun',
    expectedHead: 'REVIEWED_HEAD_SHA',
    expectedBase: 'REVIEWED_BASE_SHA',
    request: {
      repository_full_name: 'owner/repository',
      head: 'feature-branch',
      base: 'DEFAULT_BRANCH',
      draft: true,
      title: '変更内容',
      body: '背景・解決内容・検証結果',
    },
  },
);
text(result);
```

`created-verified` のときだけ、返されたPRのhead/baseが照合できたと報告する。`creation-unverified` は作成自体が成功している可能性があるため、結果のURLと状態を調べ、作成を盲目的に再試行しない。コネクタが例外を返してURLを取得できなかった場合は、診断情報を確認し、GitHubで対象リポジトリのhead/baseに一致するPRを探す。作成後は正確なheadのCIとレビューコメントを確認する。

## 強制する範囲

このラッパーは、未収束、証跡なし、汚れた作業ツリー、対象不一致、古いhead/base、通信失敗、未完了のチェック、不正な応答では作成コネクタを呼ばない。既存のフック対応ホストではCodexアダプターが `Bash` と `exec_command` を共有フックへ渡すが、ホストが `.codex/hooks.json` を読むことが前提になる。`functions.exec` 内の全呼び出しを自動捕捉する設定ではない。

別CLI、GitHub画面、直接API、reopen、作成後のpush、改変されたラッパーはこの入口の外にある。レビュー記録は自己申告で、判定と作成の間のリモート更新もGitHubとの原子的操作にはできない。返却されたhead/baseが違えば未検証として報告する。既存共有ゲートのorigin照合はURL末尾のowner/repoを使い、ホストの真正性までは検証しない。

CIのフックテストは判定実装の検証であり、各PRの独立レビュー実施の認証ではない。全経路の統制やマージ時の強制には、ホスト側のツール制御やGitHubの権限・必須チェック設定が別途必要になる。これらの外部設定をこのラッパーは変更しない。

## gh が認証できないクラウドで既存 PR の外部指摘を観測する

GitHub コネクタが利用可能な場合、レビュー前の観測と push 直前の再取得には `.codex/cloud-pr-feedback.cjs` を使う。`functions.exec` 内でレビュー済みのソースを読み、`exec`・`github_fetch`・`github_get_user_login` を注入する。コネクタが PR 本体、全ページのインラインコメントとレビューを取得し、Bun 側がリポジトリ・PR・ブランチ・remote head・観測時刻・指摘 ID・レビュー対象 commit を検証して既存の `.rounds.external` と同じ判定を使う。欠損、取得失敗、対象不一致では履歴を進めない。`mode: 'push'` は直前にもう一度取得してゲートを判定し、origin の push 先が観測した GitHub リポジトリと一致するときだけ検証済みのローカル SHA を指定して通常の fast-forward push を行う。観測後に 2 ラウンドの実レビューが必要な規則は変わらない。

ホストがリポジトリの PreToolUse フックを発火させる場合、この `git push` にも `require-pr-feedback-review.ts` が走り、`gh` で指摘を取り直そうとする。`gh` が使えないと取得できず止まるため、`mode: 'push'` のゲートは許可した時点でブランチと HEAD に紐づく 120 秒限りの許可（`.rounds.external.cloud-push.json`、`cloud-push-grant.ts`）を残す。フックは `gh` で取得できないときに限ってこの許可を確認し、ブランチと HEAD が一致して期限内なら 1 回だけ通して許可を消す。`gh` が使える環境では許可を見ず、従来どおり `gh` の結果で判定する。許可はレビュー記録と同じく自己申告の記録である。

```javascript
const sourceTree = '/workspace/repository/.claude/worktrees/reviewed-tooling';
const cwd = '/workspace/repository/.claude/worktrees/target-pr';
const source = await tools.exec_command({
  cmd: 'cat .codex/cloud-pr-feedback.cjs',
  workdir: sourceTree,
});
if (source.exit_code !== 0 || source.session_id !== undefined)
  throw new Error('Cannot load reviewed feedback harness');
const module = { exports: null };
new Function('module', source.output)(module);
const result = await module.exports(
  {
    exec: tools.exec_command,
    poll: tools.write_stdin,
    patch: tools.apply_patch,
    fetch: tools.mcp__codex_apps__github_fetch,
    getUserLogin: tools.mcp__codex_apps__github_get_user_login,
    now: tools.clock__curr_time,
  },
  {
    cwd,
    sourceTree,
    bun: '/path/to/bun',
    repository: 'owner/repository',
    branch: 'existing-pr-branch',
    prNumber: 123,
    mode: 'observe', // レビュー前。push 直前だけ 'push' にする
  },
);
text(result);
```

`observed` は観測時刻、PR head、指摘の総数と直近 8 件までの ID を返す。全 ID は従来の履歴に保存され、同じ ID の再観測ではラウンドの基準線が進まない。異なる HEAD への指摘が 3 回目に達したら、既存ルールどおり原因を診断し、ユーザーが選んだ方針を得てから `mode: 'consult'` と `consultationNote: '<診断と選ばれた方針>'` を渡す。このモードも最新の指摘を取得し、相談回数とメモを検証して記録する。回答前に使わない。`pushed-verified` の場合だけ返却された `finalHead` を remote commit として報告する。push が実行中のままならセッション ID を確認し、remote の状態が分かるまで再実行しない。この手順は新しいラッパー自身の PR 作成前レビューを免除しない。コードが未マージなら、その独立 PR のレビュー済みコミットから実行する。記録は独立した認証署名ではなく、コネクタから同じ呼び出し内で取得したデータの検証結果である。コネクタの権限や GitHub 側の設定は変更しない。
