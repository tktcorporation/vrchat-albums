import { describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pullsPayload, writeFakeGh } from './fake-gh.ts';
import { externalReviewFile, reviewTargetSha, writeEntries } from './review-count.ts';
import type { Entry } from './review-policy.ts';

const script = join(import.meta.dir, 'require-pr-feedback-review.ts');
const record = join(import.meta.dir, 'record-pr-feedback.ts');
const observeScript = join(import.meta.dir, 'observe-pr-feedback.ts');
const preBash = join(import.meta.dir, 'pre-bash-guard.ts');
const ORIGIN = 'https://github.com/owner/repo.git';
interface FakeThread {
  comments: {
    nodes: {
      databaseId: number;
      author: { login: string };
      pullRequestReview: { commit: { oid: string } };
      pull_request_review_id?: number;
      in_reply_to_id?: number;
    }[];
  };
}

function git(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync(['git', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
}

async function checkPush(
  cwd: string,
  bin: string,
  comments: FakeThread[] = [],
  prError = false,
  reviews: unknown[] = [],
): Promise<{ code: number; error: string }> {
  const child = Bun.spawn(['bun', script], {
    cwd,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      FAKE_COMMENTS: JSON.stringify([
        comments.flatMap((thread) =>
          thread.comments.nodes.map((comment) => ({
            id: comment.databaseId,
            commit_id: comment.pullRequestReview.commit.oid,
            created_at: `2026-09-23T00:00:${String(comment.databaseId).padStart(2, '0')}Z`,
            user: comment.author,
            pull_request_review_id: comment.pull_request_review_id,
            in_reply_to_id: comment.in_reply_to_id,
          })),
        ),
      ]),
      FAKE_REVIEWS: JSON.stringify([reviews]),
      FAKE_PR_ERROR: prError ? '1' : '',
      FAKE_GH_PULLS: pullsPayload(42),
    },
    stdin: new Blob([JSON.stringify({ cwd })]),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  return { code, error };
}

const round = (head: string, count: number, reviewer: 'other' | 'codex'): Entry => ({
  kind: 'round',
  round: { count, sha: head, reviewer, accepted: false },
});

describe('外部指摘後の push ガード', () => {
  test('git -C で別 worktree を push するときは、その作業ツリーの PR を検査する', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pr-feedback-target-'));
    try {
      const caller = join(root, 'caller');
      const target = join(root, 'target');
      const bin = join(root, 'bin');
      await Promise.all([mkdir(caller), mkdir(target), mkdir(bin)]);
      git(target, 'init', '-q');
      git(target, 'remote', 'add', 'origin', ORIGIN);
      await writeFakeGh(bin);
      const child = Bun.spawn(['bun', preBash], {
        cwd: caller,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          CLAUDE_PROJECT_DIR: join(import.meta.dir, '../..'),
          FAKE_TARGET: target,
          FAKE_GH_PULLS: pullsPayload(42),
          FAKE_COMMENTS: JSON.stringify([
            [
              {
                id: 1,
                commit_id: 'test-head',
                created_at: '2026-09-23T00:00:01Z',
                user: { login: 'reviewer' },
              },
            ],
          ]),
        },
        stdin: new Blob([
          JSON.stringify({ cwd: caller, tool_input: { command: `git -C ${target} push` } }),
        ]),
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
      expect(error).toContain('外部レビュー指摘');
      expect(code).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('default branch に取り込まれた前の作業のラウンドは、指摘後のレビューに数えない', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pr-feedback-range-'));
    try {
      const remote = join(root, 'remote.git');
      const cwd = join(root, 'clone');
      const bin = join(root, 'bin');
      await mkdir(bin);
      git(root, 'init', '-q', '--bare', '-b', 'main', remote);
      git(root, 'clone', '-q', remote, cwd);
      git(cwd, 'config', 'user.name', 'Test');
      git(cwd, 'config', 'user.email', 'test@example.com');
      git(cwd, 'checkout', '-q', '-b', 'main');
      await writeFile(join(cwd, 'README'), 'base');
      git(cwd, 'add', 'README');
      git(cwd, 'commit', '-qm', 'base');
      git(cwd, 'push', '-q', 'origin', 'main');
      git(cwd, 'remote', 'set-head', 'origin', 'main');
      // 前の作業を fast-forward で取り込み、同じ名前でブランチを作り直す。
      git(cwd, 'checkout', '-q', '-b', 'work');
      await writeFile(join(cwd, 'README'), 'previous');
      git(cwd, 'commit', '-qam', 'previous');
      const previous = await reviewTargetSha({ cwd });
      git(cwd, 'checkout', '-q', 'main');
      git(cwd, 'merge', '-q', '--ff-only', 'work');
      git(cwd, 'push', '-q', 'origin', 'main');
      git(cwd, 'checkout', '-q', '-B', 'work', 'origin/main');
      await writeFile(join(cwd, 'README'), 'fresh');
      git(cwd, 'commit', '-qam', 'fresh');
      const sha = await reviewTargetSha({ cwd });
      // PR の検索は origin の URL から owner/repo を決めるので、手元の bare リポジトリから GitHub の URL へ向け直す。
      git(cwd, 'remote', 'set-url', 'origin', ORIGIN);
      await writeFakeGh(bin);
      await Bun.write(
        await externalReviewFile({ cwd }),
        JSON.stringify({
          pr: 42,
          heads: [sha],
          seenComments: ['comment:1'],
          consultation: { kind: 'none' },
          roundsAtLastFeedback: 0,
          reviewedCommentCount: 0,
        }),
      );
      // 位置だけを数えれば 2 ラウンドで収束に見えるが、1 件目は取り込み済みの作業へのレビュー。
      await writeEntries([round(previous, 1, 'other'), round(sha, 0, 'codex')], { cwd });
      expect((await checkPush(cwd, bin)).code).toBe(2);
      await writeEntries(
        [round(previous, 1, 'other'), round(sha, 1, 'other'), round(sha, 0, 'codex')],
        { cwd },
      );
      expect((await checkPush(cwd, bin)).code).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('先頭の cd でサブディレクトリの別リポジトリへ移って push するときは、そのリポジトリを検査する', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pr-feedback-cd-'));
    try {
      const target = join(root, 'nested repo');
      const bin = join(root, 'bin');
      await Promise.all([mkdir(target), mkdir(bin)]);
      git(root, 'init', '-q');
      git(target, 'init', '-q');
      git(target, 'remote', 'add', 'origin', ORIGIN);
      await writeFakeGh(bin);
      const child = Bun.spawn(['bun', preBash], {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          CLAUDE_PROJECT_DIR: join(import.meta.dir, '../..'),
          FAKE_TARGET: target,
          FAKE_GH_PULLS: pullsPayload(42),
          FAKE_COMMENTS: JSON.stringify([
            [
              {
                id: 1,
                commit_id: 'test-head',
                created_at: '2026-09-23T00:00:01Z',
                user: { login: 'reviewer' },
              },
            ],
          ]),
        },
        stdin: new Blob([
          JSON.stringify({ cwd: root, tool_input: { command: 'cd "nested repo" && git push' } }),
        ]),
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
      expect(error).toContain('外部レビュー指摘');
      expect(code).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('同じ Bash 内の commit と push は古い HEAD の事前検査を使わせない', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'pr-feedback-compound-'));
    try {
      git(cwd, 'init', '-q');
      const child = Bun.spawn(['bun', preBash], {
        cwd,
        env: { ...process.env, CLAUDE_PROJECT_DIR: join(import.meta.dir, '../..') },
        stdin: new Blob([
          JSON.stringify({
            cwd,
            tool_input: {
              command: 'git add README && git commit -m fix && git push',
            },
          }),
        ]),
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
      expect(code).toBe(2);
      expect(error).toContain('git push を別の Bash コマンド');
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('指摘後のレビュー収束と、3 回目のユーザー判断を要求する', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'pr-feedback-'));
    try {
      git(cwd, 'init', '-q');
      git(cwd, 'config', 'user.name', 'Test');
      git(cwd, 'config', 'user.email', 'test@example.com');
      await writeFile(join(cwd, 'README'), 'test');
      git(cwd, 'add', 'README');
      git(cwd, 'commit', '-qm', 'test');
      git(cwd, 'remote', 'add', 'origin', ORIGIN);
      const bin = join(cwd, 'bin');
      await mkdir(bin);
      await writeFakeGh(bin);
      const sha = await reviewTargetSha({ cwd });
      const historyPath = await externalReviewFile({ cwd });
      const comment = (id: number, head: string, isResolved = false, login = 'reviewer') => ({
        isResolved,
        comments: {
          nodes: [
            {
              databaseId: id,
              author: { login },
              pullRequestReview: { commit: { oid: head } },
            },
          ],
        },
      });
      const firstComment = [
        {
          ...comment(1, sha),
          comments: {
            nodes: [
              comment(1, sha).comments.nodes[0],
              comment(99, sha, false, 'testuser').comments.nodes[0],
            ],
          },
        },
      ];
      // PR を確かめられないときは止めずに通す（警告は github-env-matrix.test.ts で確かめる）。
      expect((await checkPush(cwd, bin, [], true)).code).toBe(0);
      expect((await checkPush(cwd, bin, firstComment)).code).toBe(2);
      expect(await Bun.file(historyPath).exists()).toBe(true);
      await mkdir(dirname(historyPath), { recursive: true });
      const history = {
        pr: 42,
        heads: [sha],
        seenComments: ['thread:1'],
        consultation: { kind: 'none' as const },
        roundsAtLastFeedback: 0,
        reviewedCommentCount: 0,
      };
      await Bun.write(historyPath, JSON.stringify(history));
      expect((await checkPush(cwd, bin)).code).toBe(2);

      const entries: Entry[] = [
        { kind: 'round', round: { count: 1, sha, reviewer: 'other', accepted: false } },
        { kind: 'round', round: { count: 0, sha, reviewer: 'codex', accepted: false } },
      ];
      await writeEntries(entries, { cwd });
      expect((await checkPush(cwd, bin)).code).toBe(0);

      expect((await checkPush(cwd, bin, [comment(2, sha)])).code).toBe(2);
      await writeEntries([...entries, entries[1]], { cwd });
      expect((await checkPush(cwd, bin, [comment(2, sha)])).code).toBe(2);
      await writeEntries([...entries, entries[0], entries[1]], { cwd });
      expect((await checkPush(cwd, bin, [comment(2, sha)])).code).toBe(0);
      const newComment = [comment(3, 'next-head')];
      expect((await checkPush(cwd, bin, newComment)).code).toBe(2);
      await writeEntries([...entries, entries[0], entries[1], entries[0], entries[1]], { cwd });
      expect((await checkPush(cwd, bin, newComment)).code).toBe(0);

      // 自分の返信は指摘に数えず、解決済みでも未観測の外部指摘は検知する。
      expect(
        (await checkPush(cwd, bin, [comment(4, 'another-head', false, 'testuser')])).code,
      ).toBe(0);
      const multiHead = {
        ...comment(5, 'another-head', true),
        comments: {
          nodes: [
            comment(5, 'another-head').comments.nodes[0],
            comment(6, 'third-head').comments.nodes[0],
          ],
        },
      };
      expect((await checkPush(cwd, bin, [multiHead])).code).toBe(2);
      expect((await Bun.file(historyPath).json()).heads).toEqual([
        sha,
        'next-head',
        'another-head',
        'third-head',
      ]);

      await Bun.write(
        historyPath,
        JSON.stringify({
          ...history,
          heads: ['a', 'b', sha],
          seenComments: ['one', 'two', 'thread:1'],
        }),
      );
      const blocked = await checkPush(cwd, bin);
      expect(blocked.code).toBe(2);
      expect(blocked.error).toContain('ユーザーに採る方針を尋ねてください');
      await Bun.write(
        historyPath,
        JSON.stringify({
          ...history,
          heads: ['a', 'b', sha],
          seenComments: ['one', 'two', 'thread:1'],
          consultation: {
            kind: 'answered',
            through: 3,
            note: 'ユーザーの判断により再レビュー後の push を認める',
            roundsAtConsultation: 6,
          },
        }),
      );
      expect((await checkPush(cwd, bin)).code).toBe(2);
      await writeEntries(
        [...entries, entries[0], entries[1], entries[0], entries[1], entries[0], entries[1]],
        { cwd },
      );
      expect((await checkPush(cwd, bin)).code).toBe(0);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test('レビュー本文の指摘も観測し、相談記録時に届いた最新の指摘まで反映する', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'pr-feedback-body-'));
    try {
      git(cwd, 'init', '-q');
      git(cwd, 'config', 'user.name', 'Test');
      git(cwd, 'config', 'user.email', 'test@example.com');
      await writeFile(join(cwd, 'README'), 'test');
      git(cwd, 'add', 'README');
      git(cwd, 'commit', '-qm', 'test');
      git(cwd, 'remote', 'add', 'origin', ORIGIN);
      const bin = join(cwd, 'bin');
      await mkdir(bin);
      await writeFakeGh(bin);
      const review = (id: number, head: string) => ({
        id,
        commit_id: head,
        submitted_at: `2026-09-23T00:00:0${id}Z`,
        state: 'CHANGES_REQUESTED',
        body: '設計を見直してください',
        user: { login: 'reviewer' },
      });
      const sha = await reviewTargetSha({ cwd });
      const first = [
        review(1, sha),
        review(2, 'head-b'),
        { ...review(4, 'non-finding'), state: 'COMMENTED', body: 'LGTM' },
      ];
      const inline: FakeThread[] = [
        {
          comments: {
            nodes: [
              {
                databaseId: 7,
                author: { login: 'reviewer' },
                pullRequestReview: { commit: { oid: 'old-line-commit' } },
                pull_request_review_id: 1,
              },
              {
                databaseId: 8,
                author: { login: 'reviewer' },
                pullRequestReview: { commit: { oid: 'reply-commit' } },
                in_reply_to_id: 7,
              },
            ],
          },
        },
      ];
      const inlinePayload = [
        [
          {
            id: 7,
            commit_id: 'old-line-commit',
            created_at: '2026-09-23T00:00:07Z',
            user: { login: 'reviewer' },
            pull_request_review_id: 1,
          },
          {
            id: 8,
            commit_id: 'reply-commit',
            created_at: '2026-09-23T00:00:08Z',
            user: { login: 'reviewer' },
            in_reply_to_id: 7,
          },
        ],
      ];
      const observedAtArrival = Bun.spawn(['bun', observeScript], {
        cwd,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          FAKE_GH_PULLS: pullsPayload(42),
          FAKE_REVIEWS: JSON.stringify([[...first]]),
          FAKE_COMMENTS: JSON.stringify(inlinePayload),
        },
        stdin: new Blob([JSON.stringify({ cwd })]),
        stdout: 'pipe',
        stderr: 'pipe',
      });
      expect(await observedAtArrival.exited).toBe(0);
      const observed = await checkPush(cwd, bin, inline, false, first);
      expect(observed.code).toBe(2);
      const historyPath = await externalReviewFile({ cwd });
      expect((await Bun.file(historyPath).json()).heads).toEqual([sha, 'head-b']);
      await writeEntries(
        [
          { kind: 'round', round: { count: 1, sha, reviewer: 'other', accepted: false } },
          { kind: 'round', round: { count: 0, sha, reviewer: 'codex', accepted: false } },
        ],
        { cwd },
      );
      expect((await checkPush(cwd, bin, inline, false, first)).code).toBe(0);
      const child = Bun.spawn(
        [
          'bun',
          record,
          'asked',
          'レビュー継続の原因は責務の曖昧さにあり、ユーザーは境界と責務を整理してから進む方針を選んだ',
        ],
        {
          cwd,
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            FAKE_GH_PULLS: pullsPayload(42),
            FAKE_REVIEWS: JSON.stringify([[...first, review(3, 'head-c')]]),
            FAKE_COMMENTS: JSON.stringify(inlinePayload),
          },
          stdin: new Blob([JSON.stringify({ cwd })]),
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      expect(await child.exited).toBe(0);
      const history = await Bun.file(historyPath).json();
      expect(history.heads).toEqual([sha, 'head-b', 'head-c']);
      expect(history.consultation.through).toBe(3);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
