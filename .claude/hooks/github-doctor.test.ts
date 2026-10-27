/**
 * github-doctor.ts の契約テスト。gh の能力プロファイルと PR の状態ごとに、`--json` の主要フィールドを
 * 表で固定する。実物の git リポジトリと bare の origin を相手に、CLI を別プロセスで起動する。
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeCloudPushGrant } from './cloud-push-grant.ts';
import { pathWithoutGh, pullsPayload, writeFakeGh } from './fake-gh.ts';
import { fakeGitHubCheckout, neutralEnv } from './fake-github-checkout.ts';
import type { FakeGitHubCheckout } from './fake-github-checkout.ts';
import { choosePrRoute, detectHost } from './github-doctor.ts';
import type { DoctorReport, HostName } from './github-doctor.ts';

type Profile = 'full' | 'rest-only' | 'unauthenticated' | 'missing';
/** no_pr: PR が無い / clean: PR に外部指摘が無い / feedback: 未対応の変更要求レビューがある */
type DataState = 'no_pr' | 'clean' | 'feedback';

/** 表で固定する主要フィールド。値は status か cause・verdict・route。 */
interface Summary {
  gh: string;
  auth: string;
  rest: string;
  graphql: string;
  pullRequest: string;
  lsRemote: string;
  pushGate: string;
  prRoute: string;
}

const OK = 'ok';
const reachable = { lsRemote: 'found' };

const TABLE: { profile: Profile; data: DataState; expected: Summary }[] = [
  {
    profile: 'full',
    data: 'no_pr',
    expected: {
      gh: 'installed',
      auth: OK,
      rest: OK,
      graphql: OK,
      pullRequest: 'no_pr',
      ...reachable,
      pushGate: 'allow:no_pr',
      prRoute: 'create-pr',
    },
  },
  {
    profile: 'full',
    data: 'clean',
    expected: {
      gh: 'installed',
      auth: OK,
      rest: OK,
      graphql: OK,
      pullRequest: 'found',
      ...reachable,
      pushGate: 'allow:no_feedback',
      prRoute: 'create-pr',
    },
  },
  {
    profile: 'full',
    data: 'feedback',
    expected: {
      gh: 'installed',
      auth: OK,
      rest: OK,
      graphql: OK,
      pullRequest: 'found',
      ...reachable,
      pushGate: 'block:review_locally',
      prRoute: 'create-pr',
    },
  },
  {
    profile: 'rest-only',
    data: 'no_pr',
    expected: {
      gh: 'installed',
      auth: OK,
      rest: OK,
      graphql: 'access_denied',
      pullRequest: 'no_pr',
      ...reachable,
      pushGate: 'allow:no_pr',
      prRoute: 'create-pr',
    },
  },
  {
    profile: 'rest-only',
    data: 'clean',
    expected: {
      gh: 'installed',
      auth: OK,
      rest: OK,
      graphql: 'access_denied',
      pullRequest: 'found',
      ...reachable,
      pushGate: 'allow:no_feedback',
      prRoute: 'create-pr',
    },
  },
  {
    profile: 'rest-only',
    data: 'feedback',
    expected: {
      gh: 'installed',
      auth: OK,
      rest: OK,
      graphql: 'access_denied',
      pullRequest: 'found',
      ...reachable,
      pushGate: 'block:review_locally',
      prRoute: 'create-pr',
    },
  },
  {
    profile: 'unauthenticated',
    data: 'clean',
    expected: {
      gh: 'installed',
      auth: 'unauthenticated',
      rest: 'unauthenticated',
      graphql: 'unauthenticated',
      pullRequest: 'unauthenticated',
      ...reachable,
      pushGate: 'allow:unchecked',
      prRoute: 'mcp',
    },
  },
  {
    profile: 'missing',
    data: 'clean',
    expected: {
      gh: 'missing',
      auth: 'gh_missing',
      rest: 'gh_missing',
      graphql: 'gh_missing',
      pullRequest: 'gh_missing',
      ...reachable,
      pushGate: 'allow:unchecked',
      prRoute: 'mcp',
    },
  },
];

const script = join(import.meta.dir, 'github-doctor.ts');
const CASE_TIMEOUT_MS = 30_000;

let root: string;
let fakeBin: string;
let noGhPath: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'github-doctor-'));
  fakeBin = join(root, 'fake-bin');
  await writeFakeGh(fakeBin);
  noGhPath = await pathWithoutGh(join(root, 'no-gh-bin'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function doctor(
  repo: FakeGitHubCheckout,
  profile: Profile,
  data: DataState,
  extraEnv: Record<string, string> = {},
): Promise<DoctorReport> {
  const env: Record<string, string | undefined> = {
    ...neutralEnv(),
    ...repo.env,
    PATH: profile === 'missing' ? noGhPath : `${fakeBin}:${process.env.PATH}`,
    FAKE_GH_PROFILE: profile === 'missing' ? undefined : profile,
    FAKE_GH_LOGIN: 'author',
    FAKE_GH_PULLS: data === 'no_pr' ? '[]' : pullsPayload(42, repo.sha),
    FAKE_REVIEWS: JSON.stringify([
      data === 'feedback'
        ? [
            {
              id: 2,
              commit_id: repo.sha,
              submitted_at: '2026-09-23T00:00:02Z',
              state: 'CHANGES_REQUESTED',
              user: { login: 'reviewer' },
            },
          ]
        : [],
    ]),
    ...extraEnv,
  };
  const child = Bun.spawn(['bun', script, '--json'], {
    cwd: repo.cwd,
    env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
  return JSON.parse(stdout);
}

const statusOf = (value: { status: string; cause?: string }): string =>
  value.status === 'unavailable' ? (value.cause ?? 'unavailable') : value.status;

function summarize(report: DoctorReport): Summary {
  return {
    gh: report.gh.status,
    auth: statusOf(report.auth),
    rest: statusOf(report.rest),
    graphql: statusOf(report.graphql),
    pullRequest: statusOf(report.pullRequest),
    lsRemote: report.lsRemote.status,
    pushGate: `${report.pushGate.verdict}:${report.pushGate.basis}`,
    prRoute: report.prRoute.route,
  };
}

describe('github-doctor.ts の環境マトリクス', () => {
  for (const row of TABLE) {
    test(
      `${row.profile} / ${row.data}`,
      async () => {
        const repo = await fakeGitHubCheckout(root);
        const report = await doctor(repo, row.profile, row.data);
        expect(summarize(report)).toEqual(row.expected);
        expect(report.repository).toEqual({
          status: 'ok',
          host: 'github.com',
          repository: 'owner/repo',
          branch: 'feature',
          defaultBranch: 'main',
        });
        expect(report.host).toEqual({ name: 'unknown', evidence: null });
      },
      CASE_TIMEOUT_MS,
    );
  }

  test(
    '診断は外部レビュー履歴を書かない（push のゲートは同じ判定を書き込みなしで評価する）',
    async () => {
      const repo = await fakeGitHubCheckout(root);
      const report = await doctor(repo, 'rest-only', 'feedback');
      expect(report.pushGate.verdict).toBe('block');
      const recorded = await readdir(join(repo.cwd, '.git', 'claude', 'pr-review')).catch(() => []);
      expect(recorded).toEqual([]);
    },
    CASE_TIMEOUT_MS,
  );

  test(
    'gh を使えないときの push 許可は確かめるだけで消費しない',
    async () => {
      const repo = await fakeGitHubCheckout(root);
      await writeCloudPushGrant({ cwd: repo.cwd }, { branch: 'feature', head: repo.sha });
      const first = await doctor(repo, 'missing', 'clean');
      const second = await doctor(repo, 'missing', 'clean');
      expect([first.pushGate, second.pushGate]).toEqual([
        { verdict: 'allow', basis: 'cloud_grant' },
        { verdict: 'allow', basis: 'cloud_grant' },
      ]);
    },
    CASE_TIMEOUT_MS,
  );

  test(
    'リモートにブランチが無ければ ls-remote は missing',
    async () => {
      const repo = await fakeGitHubCheckout(root, { push: false });
      const report = await doctor(repo, 'full', 'no_pr');
      expect(report.lsRemote).toEqual({ status: 'missing' });
    },
    CASE_TIMEOUT_MS,
  );

  test(
    'ホストの推定とその経路は環境変数に従う',
    async () => {
      const repo = await fakeGitHubCheckout(root);
      const codex = await doctor(repo, 'unauthenticated', 'clean', { CODEX_SANDBOX: 'seatbelt' });
      expect([codex.host.name, codex.prRoute.route]).toEqual(['codex', 'codex-connector']);
      const cloud = await doctor(repo, 'rest-only', 'clean', { CLAUDE_CODE_REMOTE: 'true' });
      expect([cloud.host.name, cloud.prRoute.route]).toEqual(['claude-code-cloud', 'create-pr']);
    },
    CASE_TIMEOUT_MS,
  );
});

describe('ホストの推定', () => {
  const cases: { env: Record<string, string>; name: HostName }[] = [
    { env: { CLAUDE_CODE_REMOTE: 'true', CLAUDECODE: '1' }, name: 'claude-code-cloud' },
    { env: { CLAUDECODE: '1' }, name: 'claude-code' },
    { env: { CLAUDE_CODE_REMOTE: 'false', CLAUDECODE: '1' }, name: 'claude-code' },
    { env: { CODEX_SANDBOX_NETWORK_DISABLED: '1' }, name: 'codex' },
    { env: { CURSOR_TRACE_ID: 'abc' }, name: 'cursor' },
    { env: {}, name: 'unknown' },
  ];
  for (const { env, name } of cases) {
    test(`${JSON.stringify(env)} → ${name}`, () => {
      expect(detectHost(env).name).toBe(name);
    });
  }
});

describe('PR の作成経路', () => {
  const ok = { status: 'ok' } as const;
  const denied = { status: 'unavailable', cause: 'access_denied', reason: 'x' } as const;
  const repository = {
    status: 'ok',
    host: 'github.com',
    repository: 'owner/repo',
    branch: 'feature',
    defaultBranch: 'main',
  } as const;
  const unknownHost = { name: 'unknown', evidence: null } as const;
  test('origin から対象を決められなければ、どの経路も勧めない', () => {
    const route = choosePrRoute({
      host: unknownHost,
      repository: { status: 'unavailable', reason: 'origin がありません。' },
      rest: { status: 'unavailable', cause: 'unknown', reason: 'origin がありません。' },
      graphql: ok,
    });
    expect(route).toEqual({
      route: 'none',
      reason: 'PR の対象を決められないので、どの経路でも作れません。origin がありません。',
      alternatives: [],
    });
  });
  test('REST と GraphQL が通れば create-pr.ts を勧め、gh pr create も挙げる', () => {
    const route = choosePrRoute({
      host: unknownHost,
      repository,
      rest: { ...ok, repository: 'owner/repo' },
      graphql: ok,
    });
    expect(route.route).toBe('create-pr');
    expect(route.alternatives).toEqual(['gh pr create -R github.com/owner/repo --head feature']);
  });
  test('GraphQL が使えなければ gh pr create を挙げない', () => {
    const route = choosePrRoute({
      host: unknownHost,
      repository,
      rest: { ...ok, repository: 'owner/repo' },
      graphql: denied,
    });
    expect(route).toMatchObject({ route: 'create-pr', alternatives: [] });
  });
  test('REST が使えなければ、Codex ではコネクタ、それ以外では MCP を勧める', () => {
    expect(
      choosePrRoute({ host: unknownHost, repository, rest: denied, graphql: denied }).route,
    ).toBe('mcp');
    expect(
      choosePrRoute({
        host: { name: 'codex', evidence: 'CODEX_SANDBOX=x' },
        repository,
        rest: denied,
        graphql: denied,
      }).route,
    ).toBe('codex-connector');
  });
});
