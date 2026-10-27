/**
 * create-pr.ts の契約テスト。「gh の能力プロファイル × 状況」の期待結果（終了コード・標準出力・理由）を
 * 表で宣言し、実物の git リポジトリと bare の origin を相手に CLI を別プロセスで起動して確かめる。
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXIT_CODE, parseArgs } from './create-pr.ts';
import { pathWithoutGh, pullRow, writeFakeGh } from './fake-gh.ts';
import { attest, fakeGitHubCheckout, git, neutralEnv } from './fake-github-checkout.ts';
import type { FakeGitHubCheckout } from './fake-github-checkout.ts';

type Profile = 'full' | 'rest-only' | 'unauthenticated' | 'missing';
/**
 * attested: 証跡あり・既存 PR なし / unattested: リモートの head に証跡なし / existing: 同じ head の
 * open な PR がある / head_mismatch: 作成の応答の head が確かめた SHA と違う
 */
type Scenario = 'attested' | 'unattested' | 'existing' | 'head_mismatch';

interface Expected {
  code: number;
  /** 標準出力の 1 行（URL）。空なら出力なし。 */
  stdout: string;
  /** 標準エラーに含まれる文。 */
  stderr?: string;
}

const NEW_PR = 'https://github.com/owner/repo/pull/7';
const OLD_PR = 'https://github.com/owner/repo/pull/42';
const CREATED: Expected = { code: EXIT_CODE.created, stdout: NEW_PR };
const NOT_ATTESTED: Expected = {
  code: EXIT_CODE.refused,
  stdout: '',
  stderr: 'レビューループ収束の記録がありません',
};
const EXISTS: Expected = {
  code: EXIT_CODE.exists,
  stdout: OLD_PR,
  stderr: 'open な PR #42 が既にある',
};
const UNVERIFIED: Expected = { code: EXIT_CODE.unverified, stdout: NEW_PR, stderr: '未検証' };
const UNAUTHENTICATED: Expected = {
  code: EXIT_CODE.refused,
  stdout: '',
  stderr: 'gh が GitHub に認証されていません',
};
const GH_MISSING: Expected = {
  code: EXIT_CODE.refused,
  stdout: '',
  stderr: 'gh コマンドが見つかりません',
};

const TABLE: { profile: Profile; scenario: Scenario; expected: Expected }[] = [
  { profile: 'full', scenario: 'attested', expected: CREATED },
  { profile: 'full', scenario: 'unattested', expected: NOT_ATTESTED },
  { profile: 'full', scenario: 'existing', expected: EXISTS },
  { profile: 'full', scenario: 'head_mismatch', expected: UNVERIFIED },
  { profile: 'rest-only', scenario: 'attested', expected: CREATED },
  { profile: 'rest-only', scenario: 'unattested', expected: NOT_ATTESTED },
  { profile: 'rest-only', scenario: 'existing', expected: EXISTS },
  { profile: 'rest-only', scenario: 'head_mismatch', expected: UNVERIFIED },
  // 証跡の判定は gh を使わないので、gh が使えなくても証跡が無ければその理由で止まる。
  { profile: 'unauthenticated', scenario: 'attested', expected: UNAUTHENTICATED },
  { profile: 'unauthenticated', scenario: 'unattested', expected: NOT_ATTESTED },
  { profile: 'unauthenticated', scenario: 'existing', expected: UNAUTHENTICATED },
  { profile: 'unauthenticated', scenario: 'head_mismatch', expected: UNAUTHENTICATED },
  { profile: 'missing', scenario: 'attested', expected: GH_MISSING },
  { profile: 'missing', scenario: 'unattested', expected: NOT_ATTESTED },
  { profile: 'missing', scenario: 'existing', expected: GH_MISSING },
  { profile: 'missing', scenario: 'head_mismatch', expected: GH_MISSING },
];

const script = join(import.meta.dir, 'create-pr.ts');
const CASE_TIMEOUT_MS = 30_000;
const BODY = '@not-a-file の行で始まる本文\n\n- 箇条書き\n';

let root: string;
let fakeBin: string;
let noGhPath: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'create-pr-'));
  fakeBin = join(root, 'fake-bin');
  await writeFakeGh(fakeBin);
  noGhPath = await pathWithoutGh(join(root, 'no-gh-bin'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

interface Run {
  code: number;
  stdout: string;
  stderr: string;
  calls: string[];
  sentRequest: unknown;
}

async function run(
  repo: FakeGitHubCheckout,
  profile: Profile,
  fake: Record<string, string> = {},
  args: string[] = [],
): Promise<Run> {
  const log = join(repo.cwd, '.git', 'gh-calls.log');
  const sent = join(repo.cwd, '.git', 'gh-create-input.json');
  const bodyFile = join(repo.cwd, '.git', 'pr-body.md');
  await writeFile(bodyFile, BODY);
  const env: Record<string, string | undefined> = {
    ...neutralEnv(),
    ...repo.env,
    PATH: profile === 'missing' ? noGhPath : `${fakeBin}:${process.env.PATH}`,
    FAKE_GH_PROFILE: profile === 'missing' ? undefined : profile,
    FAKE_GH_LOG: log,
    FAKE_GH_CREATE_INPUT: sent,
    ...fake,
  };
  const child = Bun.spawn(
    ['bun', script, '--title', 'タイトル', '--body-file', bodyFile, ...args],
    { cwd: repo.cwd, env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const calls = (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean);
  const sentText = await readFile(sent, 'utf8').catch(() => null);
  const sentRequest: unknown = sentText === null ? null : JSON.parse(sentText);
  return { code, stdout, stderr, calls, sentRequest };
}

/** 作成要求への応答。head は既定で確かめた SHA と同じにする。 */
const createdResponse = (headSha: string, baseRef = 'main'): string =>
  JSON.stringify(pullRow(7, headSha, baseRef));

describe('create-pr.ts の環境マトリクス', () => {
  for (const row of TABLE) {
    test(
      `${row.profile} / ${row.scenario} → 終了コード ${row.expected.code}`,
      async () => {
        const repo = await fakeGitHubCheckout(root);
        if (row.scenario !== 'unattested') await attest(repo);
        const fake: Record<string, string> = {
          FAKE_GH_CREATED: createdResponse(
            row.scenario === 'head_mismatch' ? 'f'.repeat(40) : repo.sha,
          ),
        };
        if (row.scenario === 'existing')
          fake.FAKE_GH_PULLS = JSON.stringify([pullRow(42, repo.sha)]);
        const result = await run(repo, row.profile, fake);
        expect({ code: result.code, stdout: result.stdout.trim() }).toEqual({
          code: row.expected.code,
          stdout: row.expected.stdout,
        });
        if (row.expected.stderr) expect(result.stderr).toContain(row.expected.stderr);
        // GraphQL を使う操作には頼らない。
        expect(result.calls.filter((call) => /^(?:pr|repo|api graphql)\b/u.test(call))).toEqual([]);
        const posted = result.calls.some((call) =>
          call.startsWith('api repos/owner/repo/pulls -X POST'),
        );
        expect(posted).toBe(
          row.expected.code === EXIT_CODE.created || row.expected.code === EXIT_CODE.unverified,
        );
      },
      CASE_TIMEOUT_MS,
    );
  }

  test(
    '作成の要求は、本文をファイルの JSON で渡し、head と base を確定させて送る',
    async () => {
      const repo = await fakeGitHubCheckout(root);
      await attest(repo);
      const result = await run(repo, 'rest-only', { FAKE_GH_CREATED: createdResponse(repo.sha) }, [
        '--draft',
      ]);
      expect(result.code).toBe(EXIT_CODE.created);
      expect(result.sentRequest).toEqual({
        title: 'タイトル',
        body: BODY,
        head: 'feature',
        base: 'main',
        draft: true,
      });
      expect(result.calls).toEqual([
        'api repos/owner/repo/pulls?head=owner%3Afeature&state=open&per_page=100 --hostname github.com',
        expect.stringMatching(
          /^api repos\/owner\/repo\/pulls -X POST --input \S+request\.json --hostname github\.com$/u,
        ),
      ]);
    },
    CASE_TIMEOUT_MS,
  );
});

describe('作成の要求が失敗したときの確かめ直し', () => {
  test(
    '応答が途絶えても PR が作られていれば、再試行せずにその PR を照合して返す',
    async () => {
      const repo = await fakeGitHubCheckout(root);
      await attest(repo);
      const result = await run(repo, 'rest-only', {
        FAKE_GH_CREATE_ERROR: '1',
        FAKE_GH_CREATE_MARK: join(repo.cwd, '.git', 'created'),
        FAKE_GH_PULLS_AFTER_CREATE: JSON.stringify([pullRow(7, repo.sha)]),
      });
      expect({ code: result.code, stdout: result.stdout.trim() }).toEqual({
        code: EXIT_CODE.created,
        stdout: NEW_PR,
      });
      expect(result.stderr).toContain('PR #7 は作成されていました');
      expect(result.calls.filter((call) => call.includes('-X POST'))).toHaveLength(1);
    },
    CASE_TIMEOUT_MS,
  );

  test(
    '作られた PR の head が確かめた SHA と違えば、未検証として URL を返す',
    async () => {
      const repo = await fakeGitHubCheckout(root);
      await attest(repo);
      const result = await run(repo, 'rest-only', {
        FAKE_GH_CREATE_ERROR: '1',
        FAKE_GH_CREATE_MARK: join(repo.cwd, '.git', 'created'),
        FAKE_GH_PULLS_AFTER_CREATE: JSON.stringify([pullRow(7, 'e'.repeat(40))]),
      });
      expect({ code: result.code, stdout: result.stdout.trim() }).toEqual({
        code: EXIT_CODE.unverified,
        stdout: NEW_PR,
      });
    },
    CASE_TIMEOUT_MS,
  );

  test(
    '失敗した後に PR が見つからなければ、作られていないと返す',
    async () => {
      const repo = await fakeGitHubCheckout(root);
      await attest(repo);
      const result = await run(repo, 'rest-only', { FAKE_GH_CREATE_ERROR: '1' });
      expect({ code: result.code, stdout: result.stdout }).toEqual({
        code: EXIT_CODE.refused,
        stdout: '',
      });
      expect(result.stderr).toContain('PR は作られていません');
      expect(result.calls.filter((call) => call.includes('-X POST'))).toHaveLength(1);
    },
    CASE_TIMEOUT_MS,
  );

  test(
    '応答の base が default branch と違えば、未検証として URL を返す',
    async () => {
      const repo = await fakeGitHubCheckout(root);
      await attest(repo);
      const result = await run(repo, 'full', {
        FAKE_GH_CREATED: createdResponse(repo.sha, 'release'),
      });
      expect(result.code).toBe(EXIT_CODE.unverified);
      expect(result.stderr).toContain('base が release');
    },
    CASE_TIMEOUT_MS,
  );
});

describe('作成の前提', () => {
  test(
    'origin/HEAD が無ければ止め、set-head を案内する',
    async () => {
      const repo = await fakeGitHubCheckout(root, { setHead: false });
      await attest(repo);
      const result = await run(repo, 'full', { FAKE_GH_CREATED: createdResponse(repo.sha) });
      expect(result.code).toBe(EXIT_CODE.refused);
      expect(result.stderr).toContain('git remote set-head origin --auto');
      expect(result.calls).toEqual([]);
    },
    CASE_TIMEOUT_MS,
  );

  test(
    '--base に default branch 以外を渡すと止める',
    async () => {
      const repo = await fakeGitHubCheckout(root);
      await attest(repo);
      const result = await run(repo, 'full', { FAKE_GH_CREATED: createdResponse(repo.sha) }, [
        '--base',
        'release',
      ]);
      expect(result.code).toBe(EXIT_CODE.refused);
      expect(result.stderr).toContain('default branch（main）と異なります');
      expect(result.calls).toEqual([]);
    },
    CASE_TIMEOUT_MS,
  );

  test(
    '収束を記録した後に積んで push したコミットは、証跡が無いので止める',
    async () => {
      const repo = await fakeGitHubCheckout(root);
      await attest(repo);
      await writeFile(join(repo.cwd, 'later'), 'later');
      git(repo.cwd, 'add', 'later');
      git(repo.cwd, 'commit', '-qm', 'later');
      git(repo.cwd, 'push', '-q', repo.bare, 'feature');
      const result = await run(repo, 'full', { FAKE_GH_CREATED: createdResponse(repo.sha) });
      expect(result.code).toBe(EXIT_CODE.refused);
      expect(result.stderr).toContain('レビューループ収束の記録がありません');
    },
    CASE_TIMEOUT_MS,
  );

  test(
    'ブランチを push していなければ止める',
    async () => {
      const repo = await fakeGitHubCheckout(root, { push: false });
      await attest(repo);
      const result = await run(repo, 'full', { FAKE_GH_CREATED: createdResponse(repo.sha) });
      expect(result.code).toBe(EXIT_CODE.refused);
      expect(result.stderr).toContain('feature ブランチがありません');
    },
    CASE_TIMEOUT_MS,
  );
});

describe('引数', () => {
  const cases: { argv: string[]; ok: boolean }[] = [
    { argv: ['--title', 't', '--body-file', 'b'], ok: true },
    { argv: ['--title', 't', '--body-file', 'b', '--draft', '--base', 'main'], ok: true },
    { argv: ['--body-file', 'b'], ok: false },
    { argv: ['--title', ' ', '--body-file', 'b'], ok: false },
    { argv: ['--title', 't'], ok: false },
    { argv: ['--title', 't', '--title', 'u', '--body-file', 'b'], ok: false },
    { argv: ['--title', '--body-file', 'b'], ok: false },
    { argv: ['--title', 't', '--body-file', 'b', '--head', 'x'], ok: false },
    { argv: ['--title', 't', '--body-file', 'b', '--draft', '--draft'], ok: false },
  ];
  for (const { argv, ok } of cases) {
    test(`${argv.join(' ')} → ${ok ? '受け付ける' : '誤り'}`, () => {
      expect(parseArgs(argv).kind).toBe(ok ? 'ok' : 'usage');
    });
  }
});
