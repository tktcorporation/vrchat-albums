#!/usr/bin/env bun
/**
 * 実行環境で GitHub のどの操作が使えるかを確かめ、push のゲートが通るかと、PR をどの経路で作るべきかを
 * 示す読み取り専用の診断。PR を作る・push する前に実行すれば、止まってから原因を調べずに済む。
 *
 *   bun .claude/hooks/github-doctor.ts [--json]
 *
 * 実行したディレクトリのチェックアウトを対象にする。GitHub への問い合わせは hook と同じ Port
 * （github-port.ts）を通し、push のゲートは hook と同じ判定（pr-push-gate.ts）を、外部レビュー履歴にも
 * push 許可にも書き込まずに評価する。終了コードは診断できたら 0、引数の誤りなら 2。
 */
import { createGitHubPort, runGh } from './github-port.ts';
import type { Fetched, GhRunner, GitHubUnavailableCause } from './github-port.ts';
import { hookCommand, resolveTarget } from './hook-utils.ts';
import { originDefaultBranch, remoteHead } from './pr-review-gate.ts';
import { evaluatePushGate } from './pr-push-gate.ts';
import type { PushVerdict } from './pr-push-gate.ts';

export type HostName = 'claude-code-cloud' | 'claude-code' | 'codex' | 'cursor' | 'unknown';

/** ホストの推定に使う環境変数。先に当たったものを採る（クラウドの Claude Code は CLAUDECODE も持つ）。 */
const HOST_RULES: {
  name: Exclude<HostName, 'unknown'>;
  key: string;
  matches: (v: string) => boolean;
}[] = [
  { name: 'claude-code-cloud', key: 'CLAUDE_CODE_REMOTE', matches: (v) => v === 'true' },
  { name: 'claude-code', key: 'CLAUDECODE', matches: (v) => v === '1' },
  { name: 'codex', key: 'CODEX_SANDBOX', matches: (v) => v !== '' },
  { name: 'codex', key: 'CODEX_SANDBOX_NETWORK_DISABLED', matches: (v) => v !== '' },
  { name: 'codex', key: 'CODEX_THREAD_ID', matches: (v) => v !== '' },
  { name: 'cursor', key: 'CURSOR_AGENT', matches: (v) => v !== '' },
  { name: 'cursor', key: 'CURSOR_TRACE_ID', matches: (v) => v !== '' },
];

/** detectHost が見る環境変数の名前。テストが実行したホストに左右されないよう外すのに使う。 */
export const HOST_ENV_KEYS: readonly string[] = HOST_RULES.map((rule) => rule.key);

/**
 * 環境変数から、hook を動かしているホストを推定する。ホストが変数の名前や値を変えれば外れるので、
 * 根拠にした変数を一緒に返し、どれにも当たらなければ unknown にする。
 */
export function detectHost(env: Record<string, string | undefined>): {
  name: HostName;
  evidence: string | null;
} {
  for (const rule of HOST_RULES) {
    const value = env[rule.key];
    if (value !== undefined && rule.matches(value))
      return { name: rule.name, evidence: `${rule.key}=${value}` };
  }
  return { name: 'unknown', evidence: null };
}

type Probe<T> =
  | ({ status: 'ok' } & T)
  | { status: 'unavailable'; cause: GitHubUnavailableCause; reason: string };

function probe<V, T>(fetched: Fetched<V>, map: (value: V) => T): Probe<T> {
  return fetched.kind === 'ok'
    ? { status: 'ok', ...map(fetched.value) }
    : { status: 'unavailable', cause: fetched.cause, reason: fetched.reason };
}

/** none: origin から PR の対象（リポジトリと head のブランチ）を決められず、どの経路でも作れない。 */
type PrRoute = 'create-pr' | 'codex-connector' | 'mcp' | 'none';

export interface DoctorReport {
  host: { name: HostName; evidence: string | null };
  gh: { status: 'installed'; path: string } | { status: 'missing' };
  repository:
    | {
        status: 'ok';
        host: string;
        repository: string;
        branch: string;
        defaultBranch: string | null;
      }
    | { status: 'unavailable'; reason: string };
  auth: Probe<{ login: string }>;
  rest: Probe<{ repository: string }>;
  graphql: Probe<Record<never, never>>;
  pullRequest:
    | { status: 'no_pr' }
    | { status: 'found'; number: number; url: string; headSha: string }
    | { status: 'unavailable'; cause: GitHubUnavailableCause; reason: string };
  lsRemote:
    | { status: 'found'; sha: string }
    | { status: 'missing' }
    | { status: 'error'; reason: string }
    | { status: 'skipped'; reason: string };
  pushGate:
    | {
        verdict: 'allow';
        basis: Extract<PushVerdict, { kind: 'allow' }>['basis'];
        /** GitHub を確かめられないまま通すときに hook が出す警告。 */
        warning?: string;
      }
    | {
        verdict: 'block';
        basis: Extract<PushVerdict, { kind: 'block' }>['basis'];
        message: string;
      };
  prRoute: { route: PrRoute; reason: string; alternatives: string[] };
}

/** 診断の結果から、PR を作る経路を 1 つ選ぶ。 */
export function choosePrRoute(
  report: Pick<DoctorReport, 'host' | 'rest' | 'graphql' | 'repository'>,
): DoctorReport['prRoute'] {
  if (report.repository.status !== 'ok')
    return {
      route: 'none',
      reason: `PR の対象を決められないので、どの経路でも作れません。${report.repository.reason}`,
      alternatives: [],
    };
  const createPr = hookCommand('create-pr.ts');
  const { host, repository, branch } = report.repository;
  const ghPrCreate = `gh pr create -R ${host}/${repository} --head ${branch}`;
  if (report.rest.status === 'ok') {
    return report.graphql.status === 'ok'
      ? {
          route: 'create-pr',
          reason: `gh の REST と GraphQL がどちらも通ります。${createPr} --title <題> --body-file <ファイル> で作成してください。`,
          alternatives: [ghPrCreate],
        }
      : {
          route: 'create-pr',
          reason: `gh の REST は通りますが GraphQL が使えないので、gh pr create は失敗します。${createPr} --title <題> --body-file <ファイル> で作成してください。`,
          alternatives: [],
        };
  }
  if (report.host.name === 'codex')
    return {
      route: 'codex-connector',
      reason:
        'gh の REST が使えません。.claude/guides/tools/cloud-review.md の手順で .codex/create-reviewed-pr.cjs から GitHub コネクタで作成してください。',
      alternatives: [],
    };
  return {
    route: 'mcp',
    reason:
      'gh の REST が使えません。GitHub の MCP サーバーが接続されていれば、その PR 作成ツールで作成してください（同じ証跡で判定するゲートがかかります）。接続されていなければ、gh を認証してから再診断してください。',
    alternatives: [],
  };
}

/** `cwd` のチェックアウトについて診断する。`env` は gh の検索と実行・ホストの推定に使う。 */
async function diagnose(
  cwd: string,
  env: Record<string, string | undefined> = process.env,
  runner: GhRunner = runGh,
): Promise<DoctorReport> {
  const target = await resolveTarget({ cwd });
  const port = createGitHubPort(target.cwd, runner);
  const ghPath = Bun.which('gh', { PATH: env.PATH ?? '' });
  const resolved = await port.target();
  const repository: DoctorReport['repository'] =
    resolved.kind === 'ok'
      ? {
          status: 'ok',
          host: resolved.value.host,
          repository: `${resolved.value.owner}/${resolved.value.repo}`,
          branch: resolved.value.branch,
          defaultBranch: await originDefaultBranch(target.cwd),
        }
      : { status: 'unavailable', reason: resolved.reason };
  const [auth, rest, graphql, lookup] = await Promise.all([
    port.viewerLogin(),
    port.probeRest(),
    port.probeGraphql(),
    port.findOpenPullRequest(),
  ]);
  const pullRequest: DoctorReport['pullRequest'] =
    lookup.kind === 'found'
      ? {
          status: 'found',
          number: lookup.pullRequest.number,
          url: lookup.pullRequest.url,
          headSha: lookup.pullRequest.headSha,
        }
      : lookup.kind === 'no_pr'
        ? { status: 'no_pr' }
        : { status: 'unavailable', cause: lookup.cause, reason: lookup.reason };
  let lsRemote: DoctorReport['lsRemote'];
  if (repository.status !== 'ok') {
    lsRemote = { status: 'skipped', reason: 'origin のリポジトリかブランチが分かりません' };
  } else {
    const remote = await remoteHead(target.cwd, repository.branch);
    lsRemote =
      remote.kind === 'found'
        ? { status: 'found', sha: remote.sha }
        : remote.kind === 'missing'
          ? { status: 'missing' }
          : { status: 'error', reason: remote.reason };
  }
  const verdict = await evaluatePushGate(target, { dryRun: true, port });
  const pushGate: DoctorReport['pushGate'] =
    verdict.kind === 'allow'
      ? {
          verdict: 'allow',
          basis: verdict.basis,
          ...(verdict.basis === 'unchecked' ? { warning: verdict.warning } : {}),
        }
      : { verdict: 'block', basis: verdict.basis, message: verdict.message };
  const partial = {
    host: detectHost(env),
    repository,
    rest: probe(rest, (name) => ({ repository: name })),
    graphql: probe(graphql, () => ({})),
  };
  return {
    ...partial,
    gh: ghPath ? { status: 'installed', path: ghPath } : { status: 'missing' },
    auth: probe(auth, (login) => ({ login })),
    pullRequest,
    lsRemote,
    pushGate,
    prRoute: choosePrRoute(partial),
  };
}

const state = (value: { status: string; reason?: string }): string =>
  value.status === 'ok' ? '使える' : `使えない（${value.reason ?? value.status}）`;

/** 人が読む形の診断結果。 */
function formatReport(report: DoctorReport): string {
  const lines = [
    `ホスト: ${report.host.name}${report.host.evidence ? `（${report.host.evidence} から推定）` : '（推定できません）'}`,
    `gh: ${report.gh.status === 'installed' ? report.gh.path : '見つかりません'}`,
    `origin: ${
      report.repository.status === 'ok'
        ? `${report.repository.host}/${report.repository.repository}（ブランチ ${report.repository.branch}、default branch ${report.repository.defaultBranch ?? '不明: git remote set-head origin --auto で設定してください'}）`
        : report.repository.reason
    }`,
    `認証: ${report.auth.status === 'ok' ? `${report.auth.login} としてログイン済み` : state(report.auth)}`,
    `REST: ${state(report.rest)}`,
    `GraphQL: ${state(report.graphql)}`,
    `PR: ${
      report.pullRequest.status === 'found'
        ? `#${report.pullRequest.number} ${report.pullRequest.url}`
        : report.pullRequest.status === 'no_pr'
          ? 'このブランチの open な PR はありません'
          : `確かめられません（${report.pullRequest.reason}）`
    }`,
    `git ls-remote: ${
      report.lsRemote.status === 'found'
        ? `通る（リモートの head ${report.lsRemote.sha}）`
        : report.lsRemote.status === 'missing'
          ? '通るが、リモートにこのブランチはありません'
          : `${report.lsRemote.status === 'error' ? '失敗' : '未実行'}（${report.lsRemote.reason}）`
    }`,
    `push のゲート: ${
      report.pushGate.verdict === 'allow'
        ? report.pushGate.warning
          ? `通る（警告あり: ${report.pushGate.warning}）`
          : `通る（${report.pushGate.basis}）`
        : `止まる（${report.pushGate.message}）`
    }`,
    `PR の作成経路: ${report.prRoute.route}。${report.prRoute.reason}`,
    ...report.prRoute.alternatives.map((alternative) => `  ほかに使える経路: ${alternative}`),
  ];
  return lines.join('\n');
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  if (args.some((arg) => arg !== '--json')) {
    console.error('usage: bun .claude/hooks/github-doctor.ts [--json]');
    process.exit(2);
  }
  const report = await diagnose(process.cwd());
  console.log(args.includes('--json') ? JSON.stringify(report, null, 2) : formatReport(report));
}
