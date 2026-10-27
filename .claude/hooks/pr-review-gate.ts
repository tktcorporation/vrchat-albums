/**
 * PR 作成ゲートの証跡（attestation）。レビューループが収束したとき、記録用の CLI
 * （record-pr-review.ts）がそのコミットの SHA を台帳へ書く。ゲートは PR の head になる
 * リモートブランチの SHA を引き、同じリポジトリでその SHA の証跡があるときだけ通す。
 *
 * 収束の判定は記録の時点で、記録したチェックアウトに対して済ませる。ゲートの時点で対象を
 * 推測し直さないので、サブモジュールや worktree のどこで作業していても判定がぶれない。
 * 新しいコミットは別の SHA なので、収束後に積んだコミットには改めて証跡が要る。
 *
 * 台帳はいちばん外側のスーパープロジェクトの git 共通ディレクトリに 1 つだけ置く
 * （ledgerFile）。サブモジュール（入れ子を含む）・linked worktree・サブモジュールの worktree の
 * どこで記録しても同じファイルに書かれ、`repo` で区別する。
 */
import { $ } from 'bun';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  gitCommonDir,
  hookCommand,
  originRepository,
  outermostCheckout,
  projectDirectory,
  remoteIdentity,
  workingTree,
} from './hook-utils.ts';
import type { Round } from './review-policy.ts';

export interface Attestation {
  sha: string;
  /** origin の owner/repo（小文字）。 */
  repo: string;
  /** origin の URL のホスト（小文字）。別ホストの同名リポジトリの証跡と取り違えないために持つ。 */
  host: string | null;
  branch: string;
  /** 記録したチェックアウトの絶対パス。MCP 経路がリモートを引く場所に使う。 */
  checkout: string;
  /** 収束までの指摘件数の推移（codex review のラウンドは `(codex)` 付き）。 */
  rounds: string[];
  accepted: boolean;
  at: string;
  /**
   * true の行は、それより前に書かれた同じ repo・host・SHA の証跡を、ブランチを問わず取り消す。
   * 指摘はコミットの内容に対するものなので、同じコミットを指す他のブランチの証跡も無効にする。
   * どの SHA について書くかは record-pr-review.ts が決める。
   * 取り消しより後に書かれた証跡は有効なので、再び収束すればそのブランチの証跡が戻る。
   */
  revoked?: boolean;
}

export const roundSummary = (round: Round): string =>
  round.reviewer === 'codex' ? `${round.count}(codex)` : String(round.count);

/**
 * 台帳の置き場所。プロジェクトディレクトリ（CLAUDE_PROJECT_DIR、無ければプロセスの現在地）から
 * いちばん外側のスーパープロジェクトへ辿り、その git 共通ディレクトリに置く。記録する CLI が
 * 入れ子のサブモジュールで動いても、ゲートの hook がルートで動いても、同じファイルを指す。
 */
export async function ledgerFile(): Promise<string> {
  const project = await projectDirectory();
  const start = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const outermost = await outermostCheckout(start);
  const common = outermost === null ? null : await gitCommonDir(outermost);
  // git が使えない場所では、レビュー記録（review-count.ts）と同じくプロジェクトの下に置く。
  const directory = common
    ? join(common, 'claude', 'pr-review')
    : join(project, '.claude', 'pr-review');
  return join(directory, 'attestations.jsonl');
}

const isAttestation = (value: unknown): value is Attestation => {
  if (typeof value !== 'object' || value === null) return false;
  const record: Record<string, unknown> = { ...value };
  // host を持たない行は、どのホストの記録か分からないので証跡として扱わない。
  const host = record.host;
  return (
    ['sha', 'repo', 'branch', 'checkout'].every((key) => typeof record[key] === 'string') &&
    (typeof host === 'string' || host === null) &&
    (record.revoked === undefined || typeof record.revoked === 'boolean')
  );
};

const sameCommit = (a: Attestation, b: Attestation): boolean =>
  a.host === b.host && a.repo === b.repo && a.sha === b.sha;

/**
 * 有効な証跡を古い順に返す。読めない行は飛ばす。取り消し（revoked）の行は、同じ repo・host・SHA
 * について、それより前に書かれた証跡をブランチやチェックアウトを問わずすべて無効にする。
 * 取り消しの後に書かれた証跡は有効なまま残る。
 */
export async function readAttestations(): Promise<Attestation[]> {
  const file = Bun.file(await ledgerFile());
  if (!(await file.exists())) return [];
  let live: Attestation[] = [];
  for (const line of (await file.text()).split('\n')) {
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      // 書きかけや手で壊した行は証跡として扱わない
      continue;
    }
    if (!isAttestation(value)) continue;
    const entry = value;
    if (entry.revoked === true) live = live.filter((kept) => !sameCommit(kept, entry));
    else live.push(entry);
  }
  return live;
}

/** 1 行を 1 回の追記で書く。短い追記は互いに混ざらないので、ロックは取らない。 */
export async function appendAttestation(attestation: Attestation): Promise<void> {
  const file = await ledgerFile();
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(attestation)}\n`);
}

// hook 実行系のタイムアウトは非ブロッキング（判定を捨ててツールを実行させる）扱いなので、
// 応答の返らない `git ls-remote` はそれより先にここで打ち切って deny に倒す。
// テストだけがこの値を短縮できる（伸ばす方向へは動かせない）。
const REMOTE_FETCH_TIMEOUT_MS = (() => {
  const testOverride = Number(process.env.CLAUDE_HOOK_TEST_REMOTE_FETCH_TIMEOUT_MS);
  return Number.isFinite(testOverride) && testOverride > 0
    ? Math.min(15_000, testOverride)
    : 15_000;
})();

/**
 * コマンドを実行し、期限までに終わらなければ子プロセスを kill して reject する。待つのを
 * やめるだけだと子プロセスが生き続け、それが終わるまで hook のプロセスも終了しない。
 * 子が起動した孫（ssh など）が stdout を開いたままでも待たないよう、出力の読み取りの完了を
 * 待たずに reject する。
 */
function runWithTimeout(
  argv: string[],
  env: Record<string, string | undefined>,
  ms: number,
  label: string,
): Promise<{ exitCode: number; stdout: string }> {
  const proc = Bun.spawn(argv, { env, stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`${label} がタイムアウトしました（${ms}ms）`));
    }, ms);
  });
  const finished = Promise.all([new Response(proc.stdout).text(), proc.exited]).then(
    ([stdout, exitCode]) => ({ exitCode, stdout }),
  );
  return Promise.race([finished, timeout]).finally(() => clearTimeout(timer));
}

type RemoteHead =
  | { kind: 'found'; sha: string }
  | { kind: 'missing' }
  | { kind: 'error'; reason: string };

/**
 * origin の `refs/heads/<branch>` の SHA を厳密一致で取る。`git ls-remote origin refs/heads/<branch>`
 * は末尾一致で `refs/heads/a/refs/heads/<branch>` のような別 ref にもマッチするため、
 * `--heads` の一覧から 2 列目が完全一致する行だけを使う。
 *
 * 対話プロンプト待ちでハングしないよう、HTTPS の認証プロンプトは GIT_TERMINAL_PROMPT=0 で、
 * SSH のプロンプトは既存の SSH コマンドに BatchMode=yes を足して止める。GIT_SSH だけが
 * 設定されている（-o を受け付けない実装かもしれない）ときは BatchMode を足さない。
 */
export async function remoteHead(checkout: string, branch: string): Promise<RemoteHead> {
  const existingSshCommand =
    process.env.GIT_SSH_COMMAND ||
    (await $`git -C ${checkout} config --get core.sshCommand`.quiet().nothrow()).text().trim();
  const env: Record<string, string | undefined> = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  if (existingSshCommand || !process.env.GIT_SSH) {
    env.GIT_SSH_COMMAND = `${existingSshCommand || 'ssh'} -o BatchMode=yes`;
  }
  let result: { exitCode: number; stdout: string };
  try {
    result = await runWithTimeout(
      ['git', '-C', checkout, 'ls-remote', '--heads', 'origin'],
      env,
      REMOTE_FETCH_TIMEOUT_MS,
      'git ls-remote',
    );
  } catch (error) {
    return { kind: 'error', reason: error instanceof Error ? error.message : String(error) };
  }
  if (result.exitCode !== 0)
    return {
      kind: 'error',
      reason: `git ls-remote が失敗しました（終了コード ${result.exitCode}）`,
    };
  const heads = new Map<string, string>();
  for (const line of result.stdout.split('\n')) {
    const [sha, ref] = line.trim().split(/\s+/u);
    if (sha && ref?.startsWith('refs/heads/')) heads.set(ref.slice('refs/heads/'.length), sha);
  }
  const sha = heads.get(branch);
  return sha ? { kind: 'found', sha } : { kind: 'missing' };
}

/**
 * origin の `refs/heads/<branch>` の SHA。取れない（ブランチが無い、ls-remote が失敗・タイムアウト
 * した）ときは undefined。gh を使えない環境の事前チェック（check-cloud-pr.ts・cloud-pr-feedback.ts）が、
 * ゲートと同じ上限時間と非対話の設定でリモートを読むために使う。
 */
export async function remoteHeadSha(checkout: string, branch: string): Promise<string | undefined> {
  const remote = await remoteHead(checkout, branch);
  return remote.kind === 'found' ? remote.sha : undefined;
}

/**
 * origin の取得先が、設定に書かれた URL から `url.<base>.insteadOf` で別のリポジトリへ書き換えられて
 * いるか。PR の対象は書き換える前の URL で決まる一方、`git ls-remote` は書き換えた先へ問い合わせる。
 * 書き換え先が読み取り用のミラーなどだと、古い SHA を見て未レビューの head を通しうる。
 *
 * 両方の URL を host・ポート・owner/repo に分けて（大文字小文字を区別せずに）比べ、どれかが違うか、
 * どちらかからホストを読めない（ローカルのパスや file://）ときに書き換えとみなす。既定ポートの明示
 * （https の 443・ssh の 22）は省いたものと同じに扱う。
 * `git@github.com:` を `https://github.com/` へ向けるような、scheme やユーザー名だけを変える書き換えは
 * 同じリポジトリへ問い合わせるので対象にならない。`pushInsteadOf` は取得先を変えないので対象にならない。
 */
async function fetchUrlRewritten(checkout: string): Promise<boolean> {
  const configured = await $`git -C ${checkout} config --get-all remote.origin.url`
    .quiet()
    .nothrow();
  const effective = await $`git -C ${checkout} ls-remote --get-url origin`.quiet().nothrow();
  if (configured.exitCode !== 0 || effective.exitCode !== 0) return true;
  const urls = configured
    .text()
    .split('\n')
    .filter((line) => line.trim() !== '');
  if (urls.length !== 1) return true;
  return !sameRemoteRepository(urls[0] ?? '', effective.text());
}

/**
 * 2 つのリモート URL が、同じホスト・ポートの同じ owner/repo を指すか（大文字小文字は区別しない、
 * remoteIdentity）。どちらかからホストか owner/repo を読めなければ false。
 */
export function sameRemoteRepository(configured: string, effective: string): boolean {
  const a = remoteIdentity(configured);
  return a !== null && a === remoteIdentity(effective);
}

/** 証跡の判定結果。通すときは、判定に使ったリモートの head の SHA を持つ。 */
type AttestedHead = { kind: 'attested'; sha: string } | { kind: 'denied'; reason: string };

/**
 * PR の head（`repo` の `branch`）を通してよければ null、止めるなら理由を返す。リモートの
 * branch が指す SHA に、同じ repo の証跡があるときだけ通す。`checkout` は origin を引く場所。
 */
export async function checkAttestation(
  repo: string,
  branch: string,
  checkout: string,
): Promise<string | null> {
  const verdict = await attestedRemoteHead(repo, branch, checkout);
  return verdict.kind === 'attested' ? null : verdict.reason;
}

/**
 * checkAttestation と同じ判定で、通すときは確かめたリモートの head の SHA を返す。PR を自分で
 * 作る入口（create-pr.ts）が、作成後の応答の head をこの SHA と照合するために使う。
 */
export async function attestedRemoteHead(
  repo: string,
  branch: string,
  checkout: string,
): Promise<AttestedHead> {
  const denied = (reason: string): AttestedHead => ({ kind: 'denied', reason });
  // 記録の後に origin の向き先が変わっていれば、ls-remote は別のリポジトリを見る。
  const origin = await originRepository(checkout);
  const current = origin ? `${origin.owner}/${origin.repo}`.toLowerCase() : null;
  if (current !== repo.toLowerCase())
    return denied(
      `${checkout} の origin（${current ?? '読み取れない'}）が、PR の対象 ${repo} と一致しません。対象リポジトリを origin に持つチェックアウトで収束を記録し直してください。`,
    );
  if (await fetchUrlRewritten(checkout))
    return denied(
      `${checkout} の origin の取得先が url.<base>.insteadOf で書き換えられていて、PR を作るリポジトリと SHA を確かめる相手（ホストか owner/repo）がずれうるので受け付けません。origin の取得先を別のリポジトリへ書き換えない設定で再実行してください。`,
    );
  const remote = await remoteHead(checkout, branch);
  if (remote.kind === 'error')
    return denied(
      `リモートの ${branch} ブランチを確認できません（${remote.reason}）。リモートに届く状態で再実行してください。`,
    );
  if (remote.kind === 'missing')
    return denied(
      `${repo} のリモートに ${branch} ブランチがありません。レビュー済みの HEAD を push してから再実行してください。`,
    );
  const attestations = (await readAttestations()).filter(
    (entry) => entry.repo === repo.toLowerCase() && entry.host === (origin?.host ?? null),
  );
  if (attestations.some((entry) => entry.sha === remote.sha))
    return { kind: 'attested', sha: remote.sha };
  const last = attestations.filter((entry) => entry.branch === branch).at(-1);
  return denied(
    `リモートの ${branch}（${repo}）の HEAD ${remote.sha} に、レビューループ収束の記録がありません` +
      `（このブランチで最後に収束を記録した SHA: ${last?.sha ?? 'なし'}）。` +
      '.claude/skills/pr-review-loop/SKILL.md の手順でこのコミットをレビューし、そのチェックアウトで ' +
      `${hookCommand('record-pr-review.ts')} <指摘件数> [codex] [accepted] を実行して収束を記録してから、` +
      'push して再実行してください。',
  );
}

/** 現在のブランチ名。detached HEAD や git の外なら null。 */
export async function branchName(tree: string): Promise<string | null> {
  const result = await $`git -C ${tree} symbolic-ref --quiet --short HEAD`.quiet().nothrow();
  return result.exitCode === 0 && result.text().trim() ? result.text().trim() : null;
}

/**
 * `-R HOST/OWNER/REPO`。gh は HOST を省くと GH_HOST やログイン済みのホストから補うので、
 * ゲートが確かめるホストと gh が PR を作るホストを一致させるため、HOST の明示を求める。
 */
const REPO_FLAG = /^([a-z0-9.-]+)\/([\w.-]+)\/([\w.-]+)$/iu;

/**
 * Bash の `gh pr create`（pr-create-command.ts が受け付けた形）を通してよければ null、
 * 止めるなら理由。`cwd` は gh を実行するディレクトリ、`repo`・`head` はコマンドの -R と --head。
 *
 * gh が -R や --head を省かれたときに選ぶ base リポジトリと head の ref は、リモートの構成・
 * `gh repo set-default`・追跡設定・手元のリモート追跡ブランチで決まり、ゲートの側で再現しきれない。
 * そのため両方の明示を求め、書かれた repo が実行ディレクトリの origin と一致し、書かれた branch の
 * リモートの SHA に証跡があるかだけを確かめる。-R は GH_REPO より優先されるので、環境変数で
 * 対象がずれることもない。
 */
export async function bashPrCreateDenyReason(invocation: {
  cwd: string;
  repo: string;
  head: string;
  base?: string;
}): Promise<string | null> {
  const tree = await workingTree({ cwd: invocation.cwd });
  const origin = await originRepository(tree);
  if (origin === null)
    return `${tree} の origin から owner/repo を読み取れません（URL が無いか、複数あります）。URL が 1 つの origin を設定したチェックアウトで実行してください。`;
  const repo = `${origin.owner}/${origin.repo}`.toLowerCase();
  const flag = invocation.repo.match(REPO_FLAG);
  if (!flag?.[1] || !flag[2] || !flag[3])
    return `-R/--repo はホストを含む host/owner/repo の形で指定してください（例: -R github.com/${repo}。指定: ${invocation.repo}）。`;
  if (flag[1].toLowerCase() !== origin.host)
    return `-R/--repo のホスト（${flag[1]}）が、${tree} の origin のホスト（${origin.host ?? 'ホスト無し'}）と異なります。`;
  if (`${flag[2]}/${flag[3]}`.toLowerCase() !== repo)
    return `-R/--repo の指定（${invocation.repo}）が、実行ディレクトリ ${tree} の origin（${repo}）と異なります。${invocation.repo} を origin に持つチェックアウトへ cd してから実行してください。`;
  let branch = invocation.head;
  const colon = branch.indexOf(':');
  if (colon !== -1) {
    if (branch.slice(0, colon).toLowerCase() !== repo.split('/')[0])
      return `--head の owner（${branch.slice(0, colon)}）が ${repo} の owner と異なります。フォークの PR は、フォークを origin に持つチェックアウトから作成してください。`;
    branch = branch.slice(colon + 1);
  }
  if (invocation.base !== undefined) {
    const baseReason = await baseDenyReason(tree, invocation.base);
    if (baseReason) return baseReason;
  } else {
    // --base を省いた gh は、ブランチ設定の gh-merge-base があればそれを base にする。gh の説明は
    // チェックアウト中のブランチ（branch.{current}.gh-merge-base）の設定を読むとしており、
    // --head と異なることがある。どちらの設定を読んでも base が default branch になるよう、両方を確かめる。
    const current = (await $`git -C ${tree} symbolic-ref --quiet --short HEAD`.quiet().nothrow())
      .text()
      .trim();
    for (const name of new Set([branch, current].filter(Boolean))) {
      const configuredBase = (
        await $`git -C ${tree} config --get ${`branch.${name}.gh-merge-base`}`.quiet().nothrow()
      )
        .text()
        .trim();
      if (!configuredBase) continue;
      const baseReason = await baseDenyReason(tree, configuredBase);
      if (baseReason) return baseReason;
    }
  }
  return checkAttestation(repo, branch, tree);
}

/**
 * PR の base が、レビューの範囲を決める origin の default branch（`origin/HEAD`）と同じか。
 * レビューループは `<default-branch>...HEAD` の差分を見るので、別のブランチへ向けた PR には
 * レビューしていないコミットが入りうる。base が無い（GitHub がリポジトリの default branch を使う）
 * ときは確かめない。origin/HEAD が手元に無ければ比べられないので止める。通してよければ null。
 */
export async function baseDenyReason(
  checkout: string,
  base: string | undefined,
): Promise<string | null> {
  if (base === undefined) return null;
  const defaultBranch = await originDefaultBranch(checkout);
  if (defaultBranch === null)
    return `${checkout} で origin の default branch が分からないので、base（${base}）を確かめられません。git remote set-head origin --auto を実行してから再実行してください。`;
  if (base !== defaultBranch)
    return `PR の base（${base}）が origin の default branch（${defaultBranch}）と異なります。レビューは ${defaultBranch} との差分に対して行うので、base は ${defaultBranch} にするか省いてください。`;
  return null;
}

/** origin の default branch の名前（`origin/HEAD` が指すブランチ）。手元に設定が無ければ null。 */
export async function originDefaultBranch(checkout: string): Promise<string | null> {
  const head = await $`git -C ${checkout} symbolic-ref --quiet --short refs/remotes/origin/HEAD`
    .quiet()
    .nothrow();
  const name =
    head.exitCode === 0
      ? head
          .text()
          .trim()
          .replace(/^origin\//u, '')
      : '';
  return name === '' ? null : name;
}

/** PreToolUse の deny 応答（Claude Code の hookSpecificOutput プロトコル）。 */
export function denyJson(reason: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
}
