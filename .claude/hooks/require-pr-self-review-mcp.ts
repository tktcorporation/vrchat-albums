#!/usr/bin/env bun
/**
 * PreToolUse(mcp__*__[github_]create_pull_request、
 *   Cursor では MCP:[github_]create_pull_request): GitHub MCP 経由の PR 作成にも、Bash の
 * `gh pr create` と同じレビュー収束ゲート（.claude/rules/pr-self-review.md）を適用する。
 *
 * `require-pr-self-review.ts` は Bash コマンド文字列の解析（isPrCreateCommand）にしか
 * 反応しないため、mcp__github__create_pull_request で直接 PR を作ると素通りする。
 * 収束判定自体（pr-review-gate.ts）は経路非依存なので、MCP ツールの tool_input
 * （owner/repo/head）から求めた対象に同じ判定を適用する。
 *
 * 許可するのは、次の 2 点を両方確認できたときだけ:
 * 1. 対象（owner/repo/head）が、作業ツリーの origin リモート・現在のブランチと一致する
 *    （head の "owner:branch" 形式は owner 部分がベースリポジトリの owner と一致する
 *    場合だけ受け付ける。owner 部分を無視すると、無関係な "<他人>:<一致するブランチ名>" が
 *    origin と同じ owner/repo に見えてすり抜ける。owner が異なる本来のフォーク間 PR は
 *    次段落のとおり常にブロックする）。
 * 2. リモートの head ブランチの HEAD が、ローカルでレビュー済みの HEAD と同じコミットを
 *    指している（ローカルで収束させた後に mcp__github__push_files 等でリモートへ別コミット
 *    を積むと、ローカル HEAD だけを見る判定は素通りしてしまうため）。
 *
 * どちらか一方でも確認できない場合は常にブロックする（ローカルの記録を対象にできない
 * 呼び出しを通す判断はしない）。base/head の owner が異なる本来のフォーク間 PR は、
 * head 側のリポジトリを作業ツリーの origin にできない（origin は base 側を指す）ため
 * 常にこの経路でブロックする。フォーク間 PR は gh pr create（Bash）で作成する。
 *
 * 対象外（既知の限界）: 一度 close した PR を state: "open" で reopen する経路
 * （mcp__github__update_pull_request）は、この hook の対象である「新規 PR 作成」に
 * 当たらないため塞いでいない。reopen 前に head へ push されたレビュー前のコミットを
 * 防げない。`gh api -X POST .../pulls` のような、gh の pr サブコマンドを経由しない
 * 生の API 呼び出しも `isPrCreateCommand` の対象外。tool_input の owner/repo は
 * origin リモートの URL から切り出した文字列とだけ突き合わせており、その URL の
 * ホスト自体が実際に対象の GitHub インスタンスかは確認していない。どれも `--head` の
 * 運用上の注意（pr-self-review.md の「仕組み」節）と同様、意図的な誤用までは
 * 仕組みで防いでいない。
 */
import { $ } from 'bun';
import { currentBranch, workingTree, type HookInput } from './hook-utils.ts';
import { convergenceDenyReason, denyJson } from './pr-review-gate.ts';
import { readRounds, reviewTargetSha } from './review-count.ts';
import { prCreateTarget } from './pr-create-target.ts';

const PREFIX = 'PR作成をブロックしました（GitHub MCP 経由）。';

// Claude Code の PreToolUse `command` hook は既定で 600 秒後にタイムアウトし
// （https://code.claude.com/docs/en/hooks.md の Common fields。30 秒への短縮は
// UserPromptSubmit / PreModelSwitch / PostModelSwitch だけが対象で PreToolUse には
// 適用されない）、そのタイムアウトは非ブロッキング（hook の判定を捨ててツール実行を
// 続行させる）扱いになる。Cursor・Codex 側の既定値やユーザーが設定した `timeout` は
// 未検証・可変。接続は確立したが応答が返らない `git ls-remote`（withTimeout() の
// JSDoc を参照）を、hook 実行系側のタイムアウトより先にここで打ち切って deny() に
// 倒すための見切りを、hook 自身の中に短く（15 秒で）持つ。この見切りが deny() に
// 倒し切れるのは、hook 実行系側のタイムアウトが 15 秒 + hook 自身のオーバーヘッドより
// 長い場合だけ（Claude Code の既定 600 秒はこれを満たすが、ユーザーが `timeout` を
// 短く設定した場合は満たさないことがある）。
//
// テストだけがこの値を「短縮」できる（本番の 15 秒を伸ばす方向へは動かせない）。
// タイムアウト経路自体を、実際にハングするプロセスを使って数十秒待たずに検証するため。
const REMOTE_FETCH_TIMEOUT_MS = (() => {
  const testOverride = Number(process.env.CLAUDE_HOOK_TEST_REMOTE_FETCH_TIMEOUT_MS);
  return Number.isFinite(testOverride) && testOverride > 0
    ? Math.min(15_000, testOverride)
    : 15_000;
})();

function deny(reason: string): never {
  throw new Error(reason);
}

/**
 * `promise` が `ms` 以内に解決しなければ拒否する。`git ls-remote` は、接続だけ
 * 受け付けて応答しないサーバーのように、OS の TCP タイムアウトでは打ち切られない
 * 形で上限なくハングしうる（未到達の接続自体は OS レベルで数十秒〜二分程度の
 * タイムアウトが働くが、これはその種のハングを防がない）。hook 実行系のタイムアウト
 * （Claude Code の PreToolUse `command` hook は既定 600 秒・非ブロッキング。
 * Cursor・Codex の値やユーザー設定はここでは未検証）より長く待つと、
 * hook の判定そのものが捨てられて fail-open しうるため、それより先にここで
 * 打ち切って deny() に倒す。タイムアウトした側の実プロセスはこの関数からは
 * kill できないため残る可能性があるが、この hook 自身はすぐ deny() で終了する
 * ため、待ち続けて fail-open する経路は塞がれる。
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} がタイムアウトしました（${ms}ms）`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * `refs/heads/<branch>` の HEAD SHA を厳密一致で取る。`git ls-remote origin
 * refs/heads/<branch>` は実際には tail/wildmatch で、`refs/heads/feature` は
 * `refs/heads/a/refs/heads/feature` のような別 ref にもマッチしてしまう
 * （そのうえ出力は ref のソート順で、先頭行を拾うだけでは狙った ref を
 * 取り出せない）。悪意のある別ブランチ（例: `a/refs/heads/<branch>`）を
 * 先に push しておけば、その SHA を「本来のブランチの HEAD」として誤認させ、
 * 未レビューのコミットが乗った本来のブランチを通せてしまう。
 * `--heads` で絞ったうえで、2 列目が完全一致する行だけを対象にする。
 */
export async function remoteHeadSha(tree: string, branch: string): Promise<string | undefined> {
  // GIT_TERMINAL_PROMPT=0 は HTTPS の認証プロンプトだけを止める。SSH の passphrase /
  // known_hosts 確認プロンプトは GIT_SSH_COMMAND に BatchMode=yes を足して止める。どちらも、
  // 対話プロンプト待ちでハングした hook が非ブロッキング扱いになり、黙って許可に
  // 倒れかねないのを避けるため（ネットワーク到達不能自体のハングまでは防がない）。
  //
  // "VAR=value command" をコマンド文字列に埋め込む形は、その変数が既にプロセスへ
  // 継承済みだと上書きではなく追加になり（bun shell の挙動）、git 自身は最初に現れた
  // （継承済みの）値を見てしまうため効かない。`.env()` で子プロセスの環境そのものを
  // 差し替える。
  //
  // GIT_SSH_COMMAND は git の優先順位で core.sshCommand / GIT_SSH より勝つため、
  // 固定で 'ssh -o BatchMode=yes' に置き換えると、デプロイキー指定など既存の
  // core.sshCommand（あるいは呼び出し元が既に設定した GIT_SSH_COMMAND）を消してしまい、
  // その設定に依存する SSH origin では ls-remote 自体が失敗して常に deny になる
  // （fail-closed であり抜け穴にはならないが、意図しない構成依存の deny を生む）。
  // 既存の値を土台にして BatchMode=yes を足す。GIT_SSH（旧来の SSH 上書き手段。
  // plink 等 -o を受け付けない実装もある）だけが設定されている場合は、GIT_SSH_COMMAND
  // を設定すると GIT_SSH ごと上書きしてしまうため、BatchMode の付与を諦めて何もしない。
  // 既存の core.sshCommand / GIT_SSH_COMMAND 自体が plink 等 -o を受け付けない実装の
  // 場合は、この既知の対応範囲外（BatchMode の付与によって ls-remote が失敗し、
  // fail-closed で deny になる）。
  const existingSshCommand =
    process.env.GIT_SSH_COMMAND ||
    (await $`git -C ${tree} config --get core.sshCommand`.quiet().nothrow()).text().trim();
  const env: Record<string, string | undefined> = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  if (existingSshCommand || !process.env.GIT_SSH) {
    env.GIT_SSH_COMMAND = `${existingSshCommand || 'ssh'} -o BatchMode=yes`;
  }
  const result = await withTimeout(
    $`git -C ${tree} ls-remote --heads origin`.env(env).quiet().nothrow(),
    REMOTE_FETCH_TIMEOUT_MS,
    'git ls-remote',
  );
  if (result.exitCode !== 0) return undefined;
  const target = `refs/heads/${branch}`;
  for (const line of result.text().split('\n')) {
    const [sha, ref] = line.trim().split(/\s+/);
    if (ref === target) return sha;
  }
  return undefined;
}

export async function requireReviewedPr(
  input: HookInput,
): Promise<{ headSha: string; headBranch: string }> {
  const { owner, repo, head } = prCreateTarget(input.tool_input);

  // フォーク元からの PR は head が "<head 側の owner>:<branch>" 形式になる。
  // 同一リポジトリ内の PR では owner 部分を省略でき、その場合はベースの owner と同じとみなす。
  const hasForkPrefix = head.includes(':');
  const headOwner = hasForkPrefix ? head.slice(0, head.indexOf(':')) : owner;
  const headBranch = hasForkPrefix ? head.slice(head.indexOf(':') + 1) : head;

  // base と head の owner が異なる本来のフォーク間 PR は、この経路では常にブロックする
  // （既知の限界。上のヘッダコメントを参照）。head 側のリポジトリはローカルの origin
  // と別なので、下の一般的な不一致メッセージが案内する「origin にクローンして
  // チェックアウトする」手順が成立しない。専用のメッセージで案内する。
  if (hasForkPrefix && headOwner.toLowerCase() !== owner.toLowerCase()) {
    deny(
      `${PREFIX}head（${head}）はベースリポジトリ（${owner}/${repo}）と owner の異なるフォーク間 PR です。この経路は base/head の owner が異なる PR を常にブロックします（.claude/rules/pr-self-review.md の「このゲートが塞がないもの」）。gh pr create（Bash）で作成してください。`,
    );
  }

  const tree = await workingTree(input);
  const remote = await $`git -C ${tree} remote get-url origin`.quiet().nothrow();
  // 末尾のスラッシュ（`.../repo/` 等）を落としてから owner/repo を切り出す。
  const remoteUrl = remote.exitCode === 0 ? remote.text().trim().replace(/\/+$/, '') : '';
  const remoteMatch = remoteUrl.match(/[:/]([^/]+)\/([^/]+?)(\.git)?$/);
  const localOwner = remoteMatch?.[1];
  const localRepo = remoteMatch?.[2];
  const localBranch = await currentBranch(tree);

  const sameTarget =
    localOwner !== undefined &&
    localOwner.toLowerCase() === owner.toLowerCase() &&
    localRepo?.toLowerCase() === repo.toLowerCase() &&
    headOwner.toLowerCase() === localOwner.toLowerCase() &&
    localBranch === headBranch;

  if (!sameTarget) {
    deny(
      `${PREFIX}対象は ${head}（${owner}/${repo}）ですが、現在の作業ツリー（${tree}）は ${localOwner ?? '不明'}/${localRepo ?? '不明'}@${localBranch} です。GitHub MCP 経由の PR 作成にも .claude/rules/pr-self-review.md のレビューループが必須です。対象リポジトリを origin にクローンし、${headBranch} ブランチをチェックアウトしたディレクトリで .claude/skills/pr-review-loop/SKILL.md の手順を回し、bun .claude/hooks/record-pr-review.ts で記録してから、そのディレクトリを cwd にして再実行してください。`,
    );
  }

  const currentSha = await reviewTargetSha(input);
  const remoteSha = await remoteHeadSha(tree, headBranch);
  if (remoteSha !== currentSha) {
    deny(
      `${PREFIX}リモートの ${headBranch} ブランチの HEAD（${remoteSha ?? '取得できませんでした'}）が、ローカルでレビュー済みの HEAD（${currentSha}）と一致しません。push してローカルとリモートを揃えてから再実行してください。`,
    );
  }

  const rounds = await readRounds(input);
  const reason = convergenceDenyReason(rounds, currentSha, PREFIX);
  if (reason) deny(reason);
  return { headSha: currentSha, headBranch };
}

if (import.meta.main) {
  try {
    await requireReviewedPr(JSON.parse(await Bun.stdin.text()));
  } catch (error) {
    console.log(denyJson(`${PREFIX}${error instanceof Error ? error.message : String(error)}`));
    process.exit(0);
  }
}
