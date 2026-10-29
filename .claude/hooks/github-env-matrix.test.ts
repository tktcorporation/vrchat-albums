/**
 * GitHub へ届く操作が実行環境ごとに違っても、PR まわりの hook が同じ規則で振る舞うことの契約テスト。
 * 「gh の能力プロファイル × PR のデータ状態 × シナリオ」の期待結果を表で宣言し、表から各ケースを作る。
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeCloudPushGrant } from './cloud-push-grant.ts';
import { pathWithoutGh, pullsPayload, writeFakeGh } from './fake-gh.ts';
import { classifyGhFailure, createGhRunner, createGitHubPort } from './github-port.ts';
import type { GitHubUnavailableCause, PullRequestLookup } from './github-port.ts';
import { reviewTargetSha } from './review-count.ts';

type Profile = 'full' | 'rest-only' | 'unauthenticated' | 'missing';
/** no_pr: ブランチに PR が無い / clean: PR はあるが外部指摘が無い / feedback: 未対応の外部指摘がある */
type DataState = 'no_pr' | 'clean' | 'feedback';
type Host = 'claude' | 'codex' | 'cursor';

/** warnings: 通すときに警告として出す文。空なら警告を出さない。 */
type PushExpectation = { allow: true; warnings: string[] } | { allow: false; messages: string[] };
type StopExpectation = { notify: false } | { notify: true; messages: string[] };
type PortExpectation =
  | { kind: 'no_pr' }
  | { kind: 'found'; number: number }
  | { kind: 'unavailable'; cause: GitHubUnavailableCause };

interface PushRow {
  profile: Profile;
  data: DataState;
  /** GitHub コネクタ経由のゲートが、現在のブランチと HEAD への push 許可を残しているか。 */
  grant: boolean;
  expected: PushExpectation;
}

const ALLOW: PushExpectation = { allow: true, warnings: [] };
const blockedBy = (...messages: string[]): PushExpectation => ({ allow: false, messages });
const UNREVIEWED = blockedBy('外部レビュー指摘の観測後に');
// 確かめられないときは止めずに、確かめられなかった理由と自己診断の手順を警告する。
const warnedBy = (...warnings: string[]): PushExpectation => ({ allow: true, warnings });
const UNAUTHENTICATED = warnedBy(
  '外部レビュー指摘を確かめられないまま push を通します',
  'gh が GitHub に認証されていません',
  'github-doctor.ts',
);
const GH_MISSING = warnedBy(
  '外部レビュー指摘を確かめられないまま push を通します',
  'gh コマンドが見つかりません',
  'github-doctor.ts',
);

/** (a) git push の PreToolUse ゲート。Claude Code・Codex・Cursor の入力形式すべてで同じ表を使う。 */
const PUSH_TABLE: PushRow[] = [
  { profile: 'full', data: 'no_pr', grant: false, expected: ALLOW },
  { profile: 'full', data: 'clean', grant: false, expected: ALLOW },
  { profile: 'full', data: 'feedback', grant: false, expected: UNREVIEWED },
  { profile: 'rest-only', data: 'no_pr', grant: false, expected: ALLOW },
  { profile: 'rest-only', data: 'clean', grant: false, expected: ALLOW },
  { profile: 'rest-only', data: 'feedback', grant: false, expected: UNREVIEWED },
  { profile: 'unauthenticated', data: 'no_pr', grant: false, expected: UNAUTHENTICATED },
  { profile: 'unauthenticated', data: 'clean', grant: false, expected: UNAUTHENTICATED },
  { profile: 'unauthenticated', data: 'feedback', grant: false, expected: UNAUTHENTICATED },
  { profile: 'unauthenticated', data: 'feedback', grant: true, expected: ALLOW },
  { profile: 'missing', data: 'no_pr', grant: false, expected: GH_MISSING },
  { profile: 'missing', data: 'clean', grant: false, expected: GH_MISSING },
  { profile: 'missing', data: 'feedback', grant: false, expected: GH_MISSING },
  { profile: 'missing', data: 'feedback', grant: true, expected: ALLOW },
];

const SILENT: StopExpectation = { notify: false };

/** (b) Stop フック。確認できない環境では毎ターン止めないよう、何も出さない。 */
const STOP_TABLE: { profile: Profile; data: DataState; expected: StopExpectation }[] = [
  { profile: 'full', data: 'no_pr', expected: SILENT },
  { profile: 'full', data: 'clean', expected: SILENT },
  {
    profile: 'full',
    data: 'feedback',
    expected: {
      notify: true,
      messages: ['未対応のレビュースレッドが 1 件', '未確認の変更要求レビュー本文が 1 件'],
    },
  },
  { profile: 'rest-only', data: 'no_pr', expected: SILENT },
  { profile: 'rest-only', data: 'clean', expected: SILENT },
  {
    profile: 'rest-only',
    data: 'feedback',
    expected: {
      notify: true,
      messages: [
        '未確認のインラインコメントが 1 件',
        '未確認の変更要求レビュー本文が 1 件',
        'src/app.ts:3 (reviewer): 境界の検証が抜けています',
      ],
    },
  },
  { profile: 'unauthenticated', data: 'no_pr', expected: SILENT },
  { profile: 'unauthenticated', data: 'feedback', expected: SILENT },
  { profile: 'missing', data: 'no_pr', expected: SILENT },
  { profile: 'missing', data: 'feedback', expected: SILENT },
];

/** (c) Port 単体の findOpenPullRequest。 */
const PORT_TABLE: { profile: Profile; data: DataState; expected: PortExpectation }[] = [
  { profile: 'full', data: 'no_pr', expected: { kind: 'no_pr' } },
  { profile: 'full', data: 'clean', expected: { kind: 'found', number: 42 } },
  { profile: 'full', data: 'feedback', expected: { kind: 'found', number: 42 } },
  { profile: 'rest-only', data: 'no_pr', expected: { kind: 'no_pr' } },
  { profile: 'rest-only', data: 'clean', expected: { kind: 'found', number: 42 } },
  { profile: 'rest-only', data: 'feedback', expected: { kind: 'found', number: 42 } },
  {
    profile: 'unauthenticated',
    data: 'no_pr',
    expected: { kind: 'unavailable', cause: 'unauthenticated' },
  },
  {
    profile: 'unauthenticated',
    data: 'clean',
    expected: { kind: 'unavailable', cause: 'unauthenticated' },
  },
  { profile: 'missing', data: 'no_pr', expected: { kind: 'unavailable', cause: 'gh_missing' } },
  { profile: 'missing', data: 'clean', expected: { kind: 'unavailable', cause: 'gh_missing' } },
];

const HOSTS: Host[] = ['claude', 'codex', 'cursor'];
const projectRoot = join(import.meta.dir, '../..');
const preBash = join(import.meta.dir, 'pre-bash-guard.ts');
const stopHook = join(import.meta.dir, 'stop-pr-comments.ts');
const codexAdapter = join(projectRoot, '.codex/run-shared-hook.ts');
const cursorAdapter = join(projectRoot, '.cursor/run-shared-hook.ts');
// 1 件ごとに git リポジトリを作り、hook を別プロセスで起動する。
const CASE_TIMEOUT_MS = 30_000;

let root: string;
let fakeBin: string;
let noGhPath: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'github-env-matrix-'));
  fakeBin = join(root, 'fake-bin');
  await writeFakeGh(fakeBin);
  noGhPath = await pathWithoutGh(join(root, 'no-gh-bin'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync(['git', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
}

interface Checkout {
  cwd: string;
  sha: string;
  env: Record<string, string | undefined>;
  log: string;
}

/** origin を GitHub に向けた feature ブランチのチェックアウトと、プロファイル・データ状態に合う環境変数。 */
async function checkout(profile: Profile, data: DataState): Promise<Checkout> {
  const cwd = await mkdtemp(join(root, 'repo-'));
  git(cwd, 'init', '-q', '-b', 'feature');
  git(cwd, 'config', 'user.name', 'Test');
  git(cwd, 'config', 'user.email', 'test@example.com');
  git(cwd, 'remote', 'add', 'origin', 'https://github.com/owner/repo.git');
  await writeFile(join(cwd, 'README'), 'test');
  git(cwd, 'add', 'README');
  git(cwd, 'commit', '-qm', 'test');
  const sha = await reviewTargetSha({ cwd });
  const log = join(cwd, '.git', 'gh-calls.log');
  const feedback = data === 'feedback';
  const env: Record<string, string | undefined> = {
    ...process.env,
    PATH: profile === 'missing' ? noGhPath : `${fakeBin}:${process.env.PATH}`,
    CLAUDE_PROJECT_DIR: projectRoot,
    XDG_STATE_HOME: join(cwd, '.git', 'state'),
    FAKE_GH_LOG: log,
    FAKE_GH_PROFILE: profile === 'missing' ? undefined : profile,
    FAKE_GH_LOGIN: 'author',
    FAKE_GH_PULLS: data === 'no_pr' ? '[]' : pullsPayload(42, sha),
    FAKE_COMMENTS: JSON.stringify([
      feedback
        ? [
            {
              id: 1,
              commit_id: sha,
              created_at: '2026-09-23T00:00:01Z',
              path: 'src/app.ts',
              line: 3,
              body: '境界の検証が抜けています',
              user: { login: 'reviewer' },
            },
          ]
        : [],
    ]),
    FAKE_REVIEWS: JSON.stringify([
      feedback
        ? [
            {
              id: 2,
              commit_id: sha,
              submitted_at: '2026-09-23T00:00:02Z',
              state: 'CHANGES_REQUESTED',
              user: { login: 'reviewer' },
            },
          ]
        : [],
    ]),
    FAKE_GH_THREADS: JSON.stringify(
      feedback
        ? [
            {
              id: 'thread-1',
              isResolved: false,
              path: 'src/app.ts',
              line: 3,
              comments: {
                nodes: [
                  {
                    databaseId: 1,
                    author: { login: 'reviewer' },
                    body: '境界の検証が抜けています',
                  },
                ],
              },
              firstComment: {
                nodes: [{ author: { login: 'reviewer' }, body: '境界の検証が抜けています' }],
              },
            },
          ]
        : [],
    ),
  };
  return { cwd, sha, env, log };
}

async function spawn(
  command: string[],
  cwd: string,
  env: Record<string, string | undefined>,
  input: unknown,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = Bun.spawn(command, {
    cwd,
    env,
    stdin: new Blob([JSON.stringify(input)]),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

/** 各ホストの入力形式で `git push` の PreToolUse を起動する。 */
function pushInvocation(host: Host, cwd: string): { command: string[]; input: unknown } {
  switch (host) {
    case 'claude':
      return {
        command: ['bun', preBash],
        input: { cwd, hook_event_name: 'PreToolUse', tool_input: { command: 'git push' } },
      };
    case 'codex':
      return {
        command: ['bun', codexAdapter, '.claude/hooks/pre-bash-guard.ts'],
        input: {
          cwd,
          hook_event_name: 'PreToolUse',
          tool_name: 'exec_command',
          tool_input: { cmd: 'git push', workdir: cwd },
        },
      };
    case 'cursor':
      return {
        command: ['bun', cursorAdapter, '.claude/hooks/pre-bash-guard.ts'],
        input: { cwd, hook_event_name: 'beforeShellExecution', command: 'git push' },
      };
  }
}

/** gh の呼び出し記録。偽 gh を置かない missing では空になる。 */
async function ghCalls(log: string): Promise<string[]> {
  const text = await readFile(log, 'utf8').catch(() => '');
  return text.split('\n').filter(Boolean);
}

describe('(a) git push の PreToolUse ゲート', () => {
  for (const host of HOSTS) {
    for (const row of PUSH_TABLE) {
      const label = `${host} / ${row.profile} / ${row.data}${row.grant ? ' / 許可あり' : ''}`;
      test(
        `${label} → ${row.expected.allow ? (row.expected.warnings.length > 0 ? '警告して通す' : '通す') : '止める'}`,
        async () => {
          const repo = await checkout(row.profile, row.data);
          if (row.grant)
            await writeCloudPushGrant({ cwd: repo.cwd }, { branch: 'feature', head: repo.sha });
          const { command, input } = pushInvocation(host, repo.cwd);
          const result = await spawn(command, repo.cwd, repo.env, input);
          const output = result.stdout + result.stderr;
          if (row.expected.allow) {
            expect(result.code).toBe(0);
            if (row.expected.warnings.length === 0) expect(output).not.toContain('WARNING');
            for (const warning of row.expected.warnings) expect(result.stdout).toContain(warning);
          } else {
            expect(result.code).toBe(2);
            for (const message of row.expected.messages) expect(output).toContain(message);
          }
          // push のゲートは GraphQL を使う操作に依存しない。
          expect(
            (await ghCalls(repo.log)).filter((call) => /^(?:pr|repo|api graphql)\b/u.test(call)),
          ).toEqual([]);
        },
        CASE_TIMEOUT_MS,
      );
    }
  }
});

test(
  '1 つのコマンドに push が複数あっても、警告は読める 1 個の JSON にまとめる',
  async () => {
    const repo = await checkout('unauthenticated', 'no_pr');
    const result = await spawn(['bun', preBash], repo.cwd, repo.env, {
      cwd: repo.cwd,
      hook_event_name: 'PreToolUse',
      tool_input: { command: 'git push && git push origin --tags' },
    });
    expect(result.code).toBe(0);
    const output: unknown = JSON.parse(result.stdout);
    expect(output).toMatchObject({ hookSpecificOutput: { hookEventName: 'PreToolUse' } });
    expect(result.stdout).toContain('外部レビュー指摘を確かめられないまま push を通します');
  },
  CASE_TIMEOUT_MS,
);

test(
  '子の出力が JSON でなくても止めずに警告し、後続の project hook を実行する',
  async () => {
    const repo = await checkout('unauthenticated', 'no_pr');
    // 子の hook を差し替えられるよう、プロジェクトのディレクトリを別に用意する。
    const project = await mkdtemp(join(root, 'project-'));
    const marker = join(project, 'project-hook-ran');
    await mkdir(join(project, '.claude/hooks/project'), { recursive: true });
    await writeFile(
      join(project, '.claude/hooks/require-pr-feedback-review.ts'),
      "console.log('debug output');\n",
    );
    await writeFile(
      join(project, '.claude/hooks/project/marker.ts'),
      `await Bun.write(${JSON.stringify(marker)}, 'ran');\n`,
    );
    const result = await spawn(
      ['bun', preBash],
      repo.cwd,
      { ...repo.env, CLAUDE_PROJECT_DIR: project },
      { cwd: repo.cwd, hook_event_name: 'PreToolUse', tool_input: { command: 'git push' } },
    );
    expect(result.code).toBe(0);
    const output: unknown = JSON.parse(result.stdout);
    expect(output).toMatchObject({ hookSpecificOutput: { hookEventName: 'PreToolUse' } });
    expect(result.stdout).toContain('出力を読めません');
    expect(await readFile(marker, 'utf8')).toBe('ran');
  },
  CASE_TIMEOUT_MS,
);

describe('(b) Stop フック', () => {
  for (const row of STOP_TABLE) {
    test(
      `${row.profile} / ${row.data} → ${row.expected.notify ? '知らせる' : '何も出さない'}`,
      async () => {
        const repo = await checkout(row.profile, row.data);
        const result = await spawn(['bun', stopHook], repo.cwd, repo.env, {
          cwd: repo.cwd,
          session_id: `matrix-${row.profile}-${row.data}`,
        });
        expect(result.code).toBe(0);
        if (!row.expected.notify) {
          expect(result.stdout).toBe('');
          return;
        }
        const decision: unknown = JSON.parse(result.stdout);
        expect(decision).toMatchObject({ decision: 'block' });
        for (const message of row.expected.messages) expect(result.stdout).toContain(message);
      },
      CASE_TIMEOUT_MS,
    );
  }
});

describe('(c) Port の findOpenPullRequest', () => {
  for (const row of PORT_TABLE) {
    test(
      `${row.profile} / ${row.data} → ${row.expected.kind}`,
      async () => {
        const repo = await checkout(row.profile, row.data);
        const port = createGitHubPort(repo.cwd, createGhRunner(repo.env));
        const lookup: PullRequestLookup = await port.findOpenPullRequest();
        switch (row.expected.kind) {
          case 'no_pr':
            expect(lookup).toEqual({ kind: 'no_pr' });
            break;
          case 'found':
            expect(lookup).toEqual({
              kind: 'found',
              pullRequest: {
                number: row.expected.number,
                headSha: repo.sha,
                baseRef: 'main',
                url: 'https://github.com/owner/repo/pull/42',
                repository: 'owner/repo',
              },
            });
            break;
          case 'unavailable':
            expect(lookup).toMatchObject({ kind: 'unavailable', cause: row.expected.cause });
            break;
        }
        // PR の検索は REST の pulls?head=owner:branch だけで行い、github.com でも
        // --hostname で origin のホストを指定する（GH_HOST が別ホストを指していても origin を見る）。
        if (row.profile !== 'missing')
          expect(await ghCalls(repo.log)).toEqual([
            'api repos/owner/repo/pulls?head=owner%3Afeature&state=open&per_page=100 --hostname github.com',
          ]);
      },
      CASE_TIMEOUT_MS,
    );
  }

  test('同じ Port で同じ操作を繰り返しても、gh は 1 回しか呼ばない', async () => {
    const calls: string[][] = [];
    const port = createGitHubPort(root, async (args) => {
      calls.push([...args]);
      return { kind: 'exited', exitCode: 0, stdout: 'author\n', stderr: '' };
    });
    await Promise.all([port.viewerLogin(), port.viewerLogin()]);
    expect(calls).toEqual([['api', 'user', '--jq', '.login']]);
  });
});

describe('gh の失敗の分類', () => {
  const cases: { exitCode: number; stderr: string; cause: GitHubUnavailableCause }[] = [
    { exitCode: 4, stderr: '', cause: 'unauthenticated' },
    { exitCode: 1, stderr: 'HTTP 401: Bad credentials', cause: 'unauthenticated' },
    {
      exitCode: 1,
      stderr: 'To get started with GitHub CLI, please run:  gh auth login',
      cause: 'unauthenticated',
    },
    {
      exitCode: 1,
      stderr: 'HTTP 403: Resource not accessible by integration',
      cause: 'access_denied',
    },
    { exitCode: 1, stderr: 'error connecting to api.github.com', cause: 'network' },
    { exitCode: 1, stderr: 'dial tcp: lookup api.github.com: no such host', cause: 'network' },
    { exitCode: 1, stderr: 'something unexpected', cause: 'unknown' },
  ];
  for (const { exitCode, stderr, cause } of cases) {
    test(`exit ${exitCode}「${stderr}」→ ${cause}`, () => {
      expect(classifyGhFailure(exitCode, stderr)).toBe(cause);
    });
  }
});
