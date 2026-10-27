import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import cloudPrFeedback from '../../.codex/cloud-pr-feedback.cjs';
import {
  assertGitBranch,
  gitValue,
  matchesGitHubRemote,
  requireEvidence,
  sameRepositoryText,
  summarizeComments,
  validateConnectorRows,
} from './cloud-pr-feedback.ts';
import { currentBranch } from './hook-utils.ts';
import { formatIsoUtc, nowMs, parseIsoUtcMs } from './iso-time.ts';
import { parseGitHubFeedback } from './pr-feedback-github.ts';
import { reviewCountFile } from './review-count.ts';

// .cjs の型は既定エクスポートの関数として推論され、付け足したプロパティが型に現れないため取り出して使う。
const cjsMatchesGitHubRemote: (remote: string, repository: string) => boolean = Reflect.get(
  cloudPrFeedback,
  'matchesGitHubRemote',
);

const head = 'a'.repeat(40);
const reviewed = 'b'.repeat(40);
const currentUtc = () => formatIsoUtc(nowMs());
const currentToolTime = () => formatIsoUtc(nowMs(), 0).replace('T', ' ').replace('Z', ' UTC');
const options = {
  cwd: '/workspace/example',
  sourceTree: '/workspace/tooling',
  repository: 'owner/repo',
  branch: 'fix/branch',
  prNumber: 42,
  mode: 'observe',
};
const pr = {
  number: 42,
  state: 'open',
  html_url: 'https://github.com/owner/repo/pull/42',
  head: { ref: 'fix/branch', sha: head, repo: { full_name: 'owner/repo' } },
  base: { repo: { full_name: 'owner/repo' } },
};
const comments = [
  {
    id: 7,
    commit_id: head,
    pull_request_review_id: 9,
    created_at: '2026-10-12T01:00:00Z',
    user: { login: 'reviewer' },
  },
  { id: 8, commit_id: head, created_at: '2026-10-12T01:01:00Z', user: { login: 'me' } },
];
const reviews = [
  {
    id: 9,
    commit_id: reviewed,
    submitted_at: '2026-10-12T01:00:00Z',
    state: 'COMMENTED',
    body: 'Finding',
    user: { login: 'reviewer' },
  },
];

describe('connector feedback boundary', () => {
  test('effective HTTPS and SSH remotes must target the observed GitHub repository', () => {
    for (const remote of [
      'https://github.com/owner/repo.git',
      'https://github.com/Owner/Repo',
      'git@github.com:owner/repo.git',
      'ssh://git@github.com/owner/repo.git',
      'ssh://git@github.com:22/owner/repo.git',
    ]) {
      expect(matchesGitHubRemote(remote, 'owner/repo')).toBe(true);
    }
    for (const remote of [
      'https://github.com/other/repo.git',
      'git@github.com:owner/other.git',
      'git@github.com.evil:owner/repo.git',
      'https://github.com.evil/owner/repo.git',
      'https://github.com/owner/repo.git?redirect=1',
      'https://github.com/owner/repo.git\nhttps://github.com/other/repo.git',
    ]) {
      expect(matchesGitHubRemote(remote, 'owner/repo')).toBe(false);
    }
  });

  test('repository names from the connector are compared case-insensitively', () => {
    expect(sameRepositoryText('Owner/Repo', 'owner/repo')).toBe(true);
    expect(
      sameRepositoryText(
        'https://github.com/Owner/Repo/pull/7',
        'https://github.com/owner/repo/pull/7',
      ),
    ).toBe(true);
    expect(sameRepositoryText('owner/other', 'owner/repo')).toBe(false);
    expect(sameRepositoryText(undefined, 'owner/repo')).toBe(false);
  });

  test('reviewed commit, exact comment ID and author filter are preserved', () => {
    // gh CLI 経路は生の行を渡す。本文の無いレビュー（body: null）でも観測できる。
    expect(
      parseGitHubFeedback({ number: 42, headRefOid: head }, 'me', comments, [
        { ...reviews[0], body: null },
      ]).kind,
    ).toBe('found');
    expect(parseGitHubFeedback({ number: 42, headRefOid: head }, 'me', comments, reviews)).toEqual({
      kind: 'found',
      pr: 42,
      remoteHead: head,
      observations: [{ head: reviewed, commentIds: ['comment:7'] }],
    });
    expect(
      parseGitHubFeedback(
        { number: 42, headRefOid: head },
        'me',
        [{ ...comments[0], commit_id: undefined }],
        reviews,
      ).kind,
    ).toBe('unavailable');
  });

  test('missing commit, malformed time and repeated IDs fail closed', () => {
    expect(() => validateConnectorRows(comments, reviews)).not.toThrow();
    expect(() => validateConnectorRows([{ ...comments[0], commit_id: '' }], reviews)).toThrow();
    expect(() =>
      validateConnectorRows([{ ...comments[0], created_at: 'unknown' }], reviews),
    ).toThrow();
    expect(() => validateConnectorRows([comments[0], comments[0]], reviews)).toThrow();
    expect(() => validateConnectorRows([{ ...comments[0], id: -1 }], reviews)).toThrow();
    expect(() =>
      validateConnectorRows([{ ...comments[0], created_at: '2026-10-12' }], reviews),
    ).toThrow();
    expect(() =>
      validateConnectorRows([{ ...comments[0], pull_request_review_id: '9' }], reviews),
    ).toThrow();
    expect(() =>
      validateConnectorRows([{ ...comments[0], in_reply_to_id: '7' }], reviews),
    ).toThrow();
    expect(
      summarizeComments(Array.from({ length: 5_000 }, (_, index) => `comment:${index + 1}`)),
    ).toEqual({
      commentCount: 5_000,
      comments: Array.from({ length: 8 }, (_, index) => `comment:${index + 4993}`),
    });
  });

  test('identity and observation time are mandatory', () => {
    const valid = {
      repository: 'owner/repo',
      branch: 'fix/branch',
      prNumber: 42,
      observedAt: currentUtc(),
      viewerLogin: 'me',
      pr,
      comments,
      reviews,
    };
    expect(() => requireEvidence(valid)).not.toThrow();
    expect(() => requireEvidence({ ...valid, observedAt: '2020-01-01T00:00:00.000Z' })).toThrow();
    expect(() => requireEvidence({ ...valid, repository: 'other/../../repo' })).toThrow();
    expect(() => requireEvidence({ ...valid, prNumber: 0 })).toThrow();
    expect(() => requireEvidence({ ...valid, branch: '' })).toThrow();
    expect(() => requireEvidence({ ...valid, viewerLogin: '' })).toThrow();
  });

  test('Git decides branch syntax, including valid non-ASCII and shell characters', () => {
    for (const branch of [
      'feature/a+b',
      'feature/a@b',
      'feature/日本語',
      'feature/a;touch',
      'feature/a$(touch)',
      "feature/a'b",
    ]) {
      expect(() => assertGitBranch(process.cwd(), branch)).not.toThrow();
    }
    for (const branch of [
      'feature/a..b',
      'feature/a@{b',
      'feature/a.lock',
      'feature/a b',
      '--danger',
      'feature/a\nother',
    ]) {
      expect(() => assertGitBranch(process.cwd(), branch)).toThrow('Git ブランチ名が不正です');
    }
  });

  test('Git names remain literal through checkout identity and review-history paths', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'feedback-branch-'));
    try {
      const git = (...args: string[]) =>
        expect(
          Bun.spawnSync({ cmd: ['git', ...args], cwd, stdout: 'ignore', stderr: 'ignore' })
            .exitCode,
        ).toBe(0);
      git('init', '-q');
      git(
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.com',
        'commit',
        '--allow-empty',
        '-q',
        '-m',
        'init',
      );
      git('switch', '-q', '-c', 'first');
      git('switch', '-q', '-c', 'second');
      expect(() => assertGitBranch(cwd, '@{-1}')).toThrow('Git ブランチ名が不正です');
      for (const branch of ['feature/a\u00a0', 'feature/a\u2003', 'feature/a\u2028']) {
        git('switch', '-q', '-c', branch);
        expect(() => assertGitBranch(cwd, branch)).not.toThrow();
        expect(await gitValue(cwd, 'symbolic-ref', '--short', 'HEAD')).toBe(branch);
        expect(await currentBranch(cwd)).toBe(branch);
        expect(await reviewCountFile({ cwd })).toEndWith(`${encodeURIComponent(branch)}.rounds`);
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test('wrapper forwards Git-valid branch names without narrowing the input', async () => {
    for (const branch of ['feature/a+b', 'feature/a@b', 'feature/日本語', "feature/a'b"]) {
      const target = { ...pr, head: { ...pr.head, ref: branch } };
      const patches: string[] = [];
      const result = await cloudPrFeedback(
        {
          getUserLogin: async () => ({ structuredContent: { login: 'me' } }),
          now: async () => ({ current_time: currentToolTime() }),
          fetch: async ({ url }: { url: string }) => ({
            structuredContent: {
              content: JSON.stringify(
                url.includes('/comments?')
                  ? comments
                  : url.includes('/reviews?')
                    ? reviews
                    : target,
              ),
            },
          }),
          patch: async (value: string) => {
            patches.push(value);
            return {};
          },
          exec: async ({ cmd }: { cmd: string }) => {
            if (cmd.startsWith('mktemp -d'))
              return { exit_code: 0, output: '/tmp/codex-pr-feedback.abc123\n' };
            if (cmd.startsWith('rmdir ')) return { exit_code: 0, output: '' };
            return {
              exit_code: 0,
              output: JSON.stringify({
                repository: 'owner/repo',
                branch,
                pr: 42,
                head,
                localHead: reviewed,
                comments: [],
                commentCount: 0,
                verdict: 'observed',
              }),
            };
          },
        },
        { ...options, branch },
      );
      expect(result.kind).toBe('observed');
      const snapshot = patches[0]!.match(/^\+(.+)$/m)?.[1];
      expect(JSON.parse(snapshot!).branch).toBe(branch);
    }
  });

  test('wrapper fetches connector pages and passes current structured evidence to Bun', async () => {
    const commands: string[] = [];
    const urls: string[] = [];
    const patches: string[] = [];
    const output = await cloudPrFeedback(
      {
        getUserLogin: async () => ({ structuredContent: { login: 'me' } }),
        now: async () => ({
          current_time: currentToolTime(),
        }),
        fetch: async ({ url }: { url: string }) => {
          urls.push(url);
          const body = url.includes('/comments?')
            ? comments
            : url.includes('/reviews?')
              ? [...reviews, { ...reviews[0], id: 10, state: 'APPROVED', body: null }]
              : pr;
          return { structuredContent: { content: JSON.stringify(body) } };
        },
        exec: async ({ cmd }: { cmd: string }) => {
          commands.push(cmd);
          if (cmd.startsWith('mktemp -d'))
            return { exit_code: 0, output: '/tmp/codex-pr-feedback.abc123\n' };
          if (cmd.startsWith('rmdir ')) return { exit_code: 0, output: '' };
          return {
            exit_code: 0,
            output: JSON.stringify({
              repository: 'owner/repo',
              branch: 'fix/branch',
              pr: 42,
              head,
              localHead: reviewed,
              comments: ['comment:7'],
              commentCount: 1,
              verdict: 'observed',
            }),
          };
        },
        patch: async (patch: string) => {
          patches.push(patch);
          return {};
        },
      },
      options,
    );
    expect(output.kind).toBe('observed');
    expect(urls).toEqual([
      'https://api.github.com/repos/owner/repo/pulls/42',
      'https://api.github.com/repos/owner/repo/pulls/42/comments?per_page=100&page=1',
      'https://api.github.com/repos/owner/repo/pulls/42/reviews?per_page=100&page=1',
    ]);
    const snapshot = patches[0]!.match(/^\+(.+)$/m)?.[1];
    const evidence = JSON.parse(snapshot!);
    expect(evidence).toMatchObject({
      repository: 'owner/repo',
      branch: 'fix/branch',
      prNumber: 42,
      viewerLogin: 'me',
      comments,
    });
    // 判定は state で行うので本文は渡さない。本文の無いレビュー（GitHub は body: null で返す）も検証を通る。
    expect(evidence.reviews[0]).toMatchObject({ id: 9, commit_id: reviewed });
    expect(evidence.reviews.every((review: object) => !('body' in review))).toBe(true);
    expect(
      parseGitHubFeedback(
        { number: 42, headRefOid: head },
        'me',
        evidence.comments,
        evidence.reviews,
      ).kind,
    ).toBe('found');
    // 証跡は保存と同じ apply_patch で消す。functions.exec のホストは rm -f / rm -rf を拒否する。
    expect(patches).toHaveLength(2);
    expect(patches[1]).toContain('*** Delete File: /tmp/codex-pr-feedback.abc123/evidence.json');
    expect(commands.some((cmd) => /^rm\s/.test(cmd))).toBe(false);
    expect(commands[1]).toContain('<');
    expect(commands.at(-1)).toContain('rmdir');
    expect(Math.abs(nowMs() - (parseIsoUtcMs(evidence.observedAt) ?? Number.NaN))).toBeLessThan(
      10_000,
    );
  });

  test('connector failure and prepush refusal never call git push', async () => {
    const commands: string[] = [];
    const connectorError = await Promise.resolve(
      cloudPrFeedback(
        {
          getUserLogin: async () => ({ structuredContent: { login: 'me' } }),
          now: async () => ({
            current_time: currentToolTime(),
          }),
          fetch: async () => ({ isError: true }),
          exec: async ({ cmd }: { cmd: string }) => {
            commands.push(cmd);
            throw new Error('must not execute');
          },
          patch: async () => ({}),
        },
        options,
      ),
    ).then(
      () => '',
      (error: unknown) => String(error),
    );
    expect(connectorError).toContain('GitHub connector read failed');
    expect(commands).toHaveLength(0);

    const gateError = await Promise.resolve(
      cloudPrFeedback(
        {
          getUserLogin: async () => ({ structuredContent: { login: 'me' } }),
          now: async () => ({
            current_time: currentToolTime(),
          }),
          fetch: async ({ url }: { url: string }) => ({
            structuredContent: {
              content: JSON.stringify(
                url.includes('/comments?') ? comments : url.includes('/reviews?') ? reviews : pr,
              ),
            },
          }),
          exec: async ({ cmd }: { cmd: string }) => {
            commands.push(cmd);
            if (cmd.startsWith('mktemp -d'))
              return { exit_code: 0, output: '/tmp/codex-pr-feedback.abc123\n' };
            if (cmd.startsWith('rmdir ')) return { exit_code: 0, output: '' };
            return { exit_code: 2, output: 'review_locally' };
          },
          patch: async () => ({}),
        },
        { ...options, mode: 'push' },
      ),
    ).then(
      () => '',
      (error: unknown) => String(error),
    );
    expect(gateError).toContain('Feedback push gate failed');
    expect(commands.some((cmd) => cmd.startsWith('git push'))).toBe(false);
    expect(commands.at(-1)).toContain('rmdir');
  });

  test('cleanup still removes the directory and keeps the gate error when deleting evidence throws', async () => {
    const commands: string[] = [];
    const error = await Promise.resolve(
      cloudPrFeedback(
        {
          getUserLogin: async () => ({ structuredContent: { login: 'me' } }),
          now: async () => ({
            current_time: currentToolTime(),
          }),
          fetch: async ({ url }: { url: string }) => ({
            structuredContent: {
              content: JSON.stringify(
                url.includes('/comments?') ? comments : url.includes('/reviews?') ? reviews : pr,
              ),
            },
          }),
          exec: async ({ cmd }: { cmd: string }) => {
            commands.push(cmd);
            if (cmd.startsWith('mktemp -d'))
              return { exit_code: 0, output: '/tmp/codex-pr-feedback.abc123\n' };
            if (cmd.startsWith('rmdir ')) return { exit_code: 0, output: '' };
            throw new Error('gate crashed');
          },
          patch: async (patch: string) => {
            if (patch.includes('*** Delete File:')) throw new Error('delete rejected');
            return {};
          },
        },
        { ...options, mode: 'push' },
      ),
    ).then(
      () => '',
      (reason: unknown) => String(reason),
    );
    expect(error).toContain('gate crashed');
    expect(commands.at(-1)).toContain('rmdir');
    expect(commands.some((cmd) => cmd.startsWith('git push'))).toBe(false);
  });

  test('push pins the reviewed SHA and refuses a moved local HEAD', async () => {
    const commands: string[] = [];
    const makeTools = (
      moved: boolean,
      destination = 'https://github.com/owner/repo.git',
      branch = 'fix/branch',
    ) => ({
      getUserLogin: async () => ({ structuredContent: { login: 'me' } }),
      now: async () => ({ current_time: currentToolTime() }),
      fetch: async ({ url }: { url: string }) => ({
        structuredContent: {
          content: JSON.stringify(
            url.includes('/comments?')
              ? comments
              : url.includes('/reviews?')
                ? reviews
                : { ...pr, head: { ...pr.head, ref: branch } },
          ),
        },
      }),
      exec: async ({ cmd }: { cmd: string }) => {
        commands.push(cmd);
        if (cmd.startsWith('mktemp -d'))
          return { exit_code: 0, output: '/tmp/codex-pr-feedback.abc123\n' };
        if (cmd.startsWith('rmdir ')) return { exit_code: 0, output: '' };
        if (cmd.includes('cloud-pr-feedback.ts'))
          return {
            exit_code: 0,
            output: JSON.stringify({
              repository: 'owner/repo',
              branch,
              pr: 42,
              head,
              localHead: reviewed,
              comments: ['comment:7'],
              commentCount: 1,
              verdict: 'allow',
            }),
          };
        if (cmd === 'git rev-parse HEAD')
          return { exit_code: 0, output: `${moved ? head : reviewed}\n` };
        if (cmd === 'git remote get-url --push --all origin')
          return { exit_code: 0, output: `${destination}\n` };
        if (cmd.includes('git ls-remote'))
          // 先頭に紛らわしい名前の別ブランチを置き、ref 名の完全一致で読むことを確かめる。
          return {
            exit_code: 0,
            output: `${head}\trefs/heads/a/refs/heads/${branch}\n${reviewed}\trefs/heads/${branch}\n`,
          };
        return { exit_code: 0, output: 'pushed' };
      },
      patch: async () => ({}),
    });
    const rejected = await Promise.resolve(
      cloudPrFeedback(makeTools(true), { ...options, mode: 'push' }),
    ).then(
      () => '',
      (error: unknown) => String(error),
    );
    expect(rejected).toContain('Local HEAD changed');
    expect(commands.some((cmd) => cmd.startsWith('git push'))).toBe(false);

    commands.length = 0;
    const result = await cloudPrFeedback(makeTools(false), { ...options, mode: 'push' });
    expect(result.kind).toBe('pushed-verified');
    expect(result.finalHead).toBe(reviewed);
    expect(commands.find((cmd) => cmd.startsWith('git push'))).toContain(reviewed);
    expect(commands.find((cmd) => cmd.startsWith('git push'))).toContain('git push origin');
    expect(commands).toContain('git remote get-url --push --all origin');
    expect(commands.find((cmd) => cmd.startsWith('git push'))).not.toContain('HEAD:');
    // 全ブランチの一覧は出力の上限で切れうるので、対象の ref だけを問い合わせる。
    expect(commands.find((cmd) => cmd.includes('git ls-remote'))).toContain(
      `--heads origin 'refs/heads/${'fix/branch'}'`,
    );

    commands.length = 0;
    const sshResult = await cloudPrFeedback(makeTools(false, 'git@github.com:owner/repo.git'), {
      ...options,
      mode: 'push',
    });
    expect(sshResult.kind).toBe('pushed-verified');
    expect(commands.find((cmd) => cmd.startsWith('git push'))).toContain(reviewed);

    for (const branch of ['feature/a;touch', "feature/a'b"]) {
      commands.length = 0;
      const special = await cloudPrFeedback(
        makeTools(false, 'https://github.com/owner/repo.git', branch),
        { ...options, branch, mode: 'push' },
      );
      expect(special.kind).toBe('pushed-verified');
      expect(commands.find((cmd) => cmd.startsWith('git push'))).toBe(
        `git push origin '${reviewed}:refs/heads/${branch.replaceAll("'", "'\\''")}'`,
      );
    }
  });

  test('push refuses a redirected origin destination', async () => {
    const commands: string[] = [];
    const error = await Promise.resolve(
      cloudPrFeedback(
        {
          getUserLogin: async () => ({ structuredContent: { login: 'me' } }),
          now: async () => ({
            current_time: currentToolTime(),
          }),
          fetch: async ({ url }: { url: string }) => ({
            structuredContent: {
              content: JSON.stringify(
                url.includes('/comments?') ? comments : url.includes('/reviews?') ? reviews : pr,
              ),
            },
          }),
          exec: async ({ cmd }: { cmd: string }) => {
            commands.push(cmd);
            if (cmd.startsWith('mktemp -d'))
              return { exit_code: 0, output: '/tmp/codex-pr-feedback.abc123\n' };
            if (cmd.startsWith('rmdir ')) return { exit_code: 0, output: '' };
            if (cmd.includes('cloud-pr-feedback.ts'))
              return {
                exit_code: 0,
                output: JSON.stringify({
                  repository: 'owner/repo',
                  branch: 'fix/branch',
                  pr: 42,
                  head,
                  localHead: reviewed,
                  comments: ['comment:7'],
                  commentCount: 1,
                  verdict: 'allow',
                }),
              };
            if (cmd === 'git rev-parse HEAD') return { exit_code: 0, output: `${reviewed}\n` };
            if (cmd === 'git remote get-url --push --all origin')
              return { exit_code: 0, output: 'https://github.com/other/repo.git\n' };
            return { exit_code: 0, output: '' };
          },
          patch: async () => ({}),
        },
        { ...options, mode: 'push' },
      ),
    ).then(
      () => '',
      (reason: unknown) => String(reason),
    );
    expect(error).toContain('push destination differs');
    expect(commands.some((cmd) => cmd.startsWith('git push'))).toBe(false);
  });

  test('consultation passes the user decision through the connector gate without pushing', async () => {
    const commands: string[] = [];
    const note = '三回の指摘を原因ごとに分析し、共有の検証境界へ集約する方針をユーザーが選んだ';
    const result = await cloudPrFeedback(
      {
        getUserLogin: async () => ({ structuredContent: { login: 'me' } }),
        now: async () => ({
          current_time: currentToolTime(),
        }),
        fetch: async ({ url }: { url: string }) => ({
          structuredContent: {
            content: JSON.stringify(
              url.includes('/comments?') ? comments : url.includes('/reviews?') ? reviews : pr,
            ),
          },
        }),
        patch: async (patch: string) => {
          if (patch.includes('*** Add File:')) expect(patch).toContain(note);
          return {};
        },
        exec: async ({ cmd }: { cmd: string }) => {
          commands.push(cmd);
          if (cmd.startsWith('mktemp -d'))
            return { exit_code: 0, output: '/tmp/codex-pr-feedback.abc123\n' };
          if (cmd.startsWith('rmdir ')) return { exit_code: 0, output: '' };
          return {
            exit_code: 0,
            output: JSON.stringify({
              repository: 'owner/repo',
              branch: 'fix/branch',
              pr: 42,
              head,
              localHead: reviewed,
              comments: ['comment:7'],
              commentCount: 1,
              verdict: 'consulted',
            }),
          };
        },
      },
      { ...options, mode: 'consult', consultationNote: note },
    );
    expect(result.kind).toBe('consulted');
    expect(commands.some((cmd) => cmd.startsWith('git push'))).toBe(false);
  });
});

// 片付けの失敗を確かめるための、ゲートの結果と apply_patch の振る舞いを差し替えられる道具一式。
function cleanupTools(gate: () => unknown, deletePatch: () => unknown) {
  const commands: string[] = [];
  return {
    commands,
    tools: {
      getUserLogin: async () => ({ structuredContent: { login: 'me' } }),
      now: async () => ({ current_time: currentToolTime() }),
      fetch: async ({ url }: { url: string }) => ({
        structuredContent: {
          content: JSON.stringify(
            url.includes('/comments?') ? comments : url.includes('/reviews?') ? reviews : pr,
          ),
        },
      }),
      exec: async ({ cmd }: { cmd: string }) => {
        commands.push(cmd);
        if (cmd.startsWith('mktemp -d'))
          return { exit_code: 0, output: '/tmp/codex-pr-feedback.abc123\n' };
        if (cmd.startsWith('rmdir ')) return { exit_code: 1, output: 'Directory not empty' };
        return gate();
      },
      patch: async (patch: string) => (patch.includes('*** Delete File:') ? deletePatch() : {}),
    },
  };
}

describe('証跡の片付けの失敗', () => {
  test('ゲートが落ち、証跡の削除も失敗したら、両方を残った場所とともに報告する', async () => {
    const { tools, commands } = cleanupTools(
      () => {
        throw new Error('gate crashed');
      },
      () => ({ isError: true }),
    );
    const error: unknown = await Promise.resolve(cloudPrFeedback(tools, options)).catch(
      (reason: unknown) => reason,
    );
    if (!(error instanceof AggregateError)) throw new Error(`unexpected: ${String(error)}`);
    const aggregate = error;
    expect(aggregate.message).toContain('gate crashed');
    expect(aggregate.message).toContain('/tmp/codex-pr-feedback.abc123/evidence.json');
    expect(aggregate.cause).toBe(aggregate.errors[0]);
    expect(String(aggregate.errors[0])).toContain('gate crashed');
    expect(commands.at(-1)).toContain('rmdir');
  });

  test('ゲートが通っても、証跡を消せなければ失敗として報告する', async () => {
    const { tools } = cleanupTools(
      () => ({ exit_code: 0, output: '{}' }),
      () => {
        throw new Error('delete rejected');
      },
    );
    const error = await Promise.resolve(cloudPrFeedback(tools, options)).then(
      () => '',
      (reason: unknown) => String(reason),
    );
    expect(error).toContain('Could not remove private connector evidence');
    expect(error).toContain('/tmp/codex-pr-feedback.abc123/evidence.json');
  });
});

describe('ラッパーに渡すパス', () => {
  test('空白・Unicode・+ を含むパスはそのまま単一引用符で渡し、改行や NUL を含むパスは拒否する', async () => {
    const commands: string[] = [];
    const sourceTree = "/work/my tools+ü/it's";
    await Promise.resolve(
      cloudPrFeedback(
        {
          ...cleanupTools(
            () => ({ exit_code: 1, output: 'denied' }),
            () => ({}),
          ).tools,
          exec: async ({ cmd }: { cmd: string }) => {
            commands.push(cmd);
            if (cmd.startsWith('mktemp -d'))
              return { exit_code: 0, output: '/tmp/codex-pr-feedback.abc123\n' };
            return { exit_code: cmd.startsWith('rmdir ') ? 0 : 1, output: 'denied' };
          },
        },
        { ...options, sourceTree, bun: '/opt/my bun/bin/bun' },
      ),
    ).catch(() => undefined);
    expect(commands).toContain(
      `'/opt/my bun/bin/bun' '/work/my tools+ü/it'\\''s/.claude/hooks/cloud-pr-feedback.ts' observe < '/tmp/codex-pr-feedback.abc123/evidence.json'`,
    );
    for (const bad of ['/work/a\nb', '/work/a\0b', 'relative/path']) {
      const error = await Promise.resolve(
        cloudPrFeedback(
          cleanupTools(
            () => ({}),
            () => ({}),
          ).tools,
          {
            ...options,
            sourceTree: bad,
          },
        ),
      ).then(
        () => '',
        (reason: unknown) => String(reason),
      );
      expect(error).toContain('Invalid connector observation arguments');
    }
  });
});

describe('origin の同一性の規則', () => {
  const urls = [
    'https://github.com/owner/repo.git',
    'https://github.com:443/owner/repo',
    'https://token@github.com/Owner/Repo.git/',
    'git@github.com:owner/repo.git',
    'ssh://git@github.com/owner/repo.git',
    'ssh://git@github.com:22/owner/repo.git',
    'ssh://git@ssh.github.com:443/owner/repo.git',
    'git@ssh.github.com:owner/repo.git',
    'git+ssh://git@github.com/owner/repo',
    'ssh://git@github.com:443/owner/repo.git',
    'https://github.com:8443/owner/repo.git',
    'https://ghe.example.com/owner/repo.git',
    'https://github.com/other/repo.git',
    'https://github.com.evil/owner/repo.git',
    'git@github.com.evil:owner/repo.git',
    'https://github.com/owner/repo.git?redirect=1',
    'https://github.com/owner/repo.git\nhttps://github.com/other/repo.git',
    'file:///srv/owner/repo.git',
    '/srv/owner/repo.git',
    'https://github.com#@evil.example/owner/repo',
    'https://github.com?@evil.example/owner/repo',
    'https://user#x@github.com/owner/repo.git',
    'https://a@b@github.com/owner/repo.git',
    'ssh://git@github.com:22?@evil.example/owner/repo.git',
    'git@github.com#@evil.example:owner/repo.git',
    'https://us%40er:p%23w@github.com/owner/repo.git',
    'https://github.com/other/repo.git?x=/owner/repo.git',
  ];

  test.each([
    'https://github.com#@evil.example/owner/repo',
    'https://github.com?@evil.example/owner/repo',
    'https://a@b@github.com/owner/repo.git',
    'git@github.com#@evil.example:owner/repo.git',
    'https://github.com/other/repo.git?x=/owner/repo.git',
    'https://github.com/other/repo.git#/owner/repo.git',
  ])('接続先やパスの切り出しが git とずれうる %p は一致とみなさない', (url) => {
    expect(matchesGitHubRemote(url, 'owner/repo')).toBe(false);
    expect(cjsMatchesGitHubRemote(url, 'owner/repo')).toBe(false);
  });

  test('ssh.github.com の 443 番ポート経由の SSH も github.com のリポジトリとして受け付ける', () => {
    expect(matchesGitHubRemote('ssh://git@ssh.github.com:443/owner/repo.git', 'owner/repo')).toBe(
      true,
    );
    expect(matchesGitHubRemote('https://github.com:8443/owner/repo.git', 'owner/repo')).toBe(false);
  });

  test.each(urls)('TS のゲートと .cjs のラッパーは %p の判定で一致する', (url) => {
    expect(cjsMatchesGitHubRemote(url, 'owner/repo')).toBe(matchesGitHubRemote(url, 'owner/repo'));
  });
});
