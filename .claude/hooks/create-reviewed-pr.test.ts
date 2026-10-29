/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import createReviewedPr from '../../.codex/create-reviewed-pr.cjs';

const options = {
  cwd: '/workspace/repository',
  bun: 'bun',
  expectedHead: 'a'.repeat(40),
  expectedBase: 'b'.repeat(40),
  request: {
    repository_full_name: 'owner/repository',
    head: 'feature',
    base: 'main',
    title: 'title',
    body: 'body',
    draft: true,
  },
};

/** 事前チェックが pollsUntilDone 回の poll の後に終わる exec / poll の組。 */
function slowPreflight(pollsUntilDone: number) {
  let polls = 0;
  const running = { session_id: 7, output: '' };
  return {
    polls: () => polls,
    tools: {
      exec: async () => running,
      poll: async () => {
        polls++;
        return polls >= pollsUntilDone ? { exit_code: 1, output: 'denied' } : running;
      },
      create: async () => {
        throw new Error('create must not be called');
      },
    },
  };
}

describe('create-reviewed-pr の事前チェック待ち', () => {
  test('ls-remote の待ち時間を超える遅い事前チェックも最後まで待つ', async () => {
    // 1 回 1 秒の poll で 45 回 = 15 秒の ls-remote 3 回分に相当する。
    const preflight = slowPreflight(45);
    const error: unknown = await createReviewedPr(preflight.tools, options).catch(
      (e: unknown) => e,
    );
    expect(String(error)).toContain('PR preflight failed: denied');
    expect(preflight.polls()).toBe(45);
  });

  test('待ち切れないときはセッション ID を返し、PR は作らない', async () => {
    const preflight = slowPreflight(Number.POSITIVE_INFINITY);
    const error: unknown = await createReviewedPr(preflight.tools, options).catch(
      (e: unknown) => e,
    );
    expect(String(error)).toContain('session 7');
  });
});

/** 事前チェックが許可を返す exec と、送られた要求を記録する create の組。 */
function allowingPreflight(digestOf: (request: typeof options.request) => string) {
  const commands: { cmd: string; workdir: string }[] = [];
  const created: unknown[] = [];
  return {
    commands,
    created,
    tools: {
      exec: async ({ cmd, workdir }: { cmd: string; workdir: string }) => {
        commands.push({ cmd, workdir });
        // printf '%s' '<JSON>' | ... の 2 つ目の引数を、sh の単一引用符の規則で戻す。
        const quoted = cmd.slice("printf '%s' ".length, cmd.lastIndexOf(' | '));
        const payload = JSON.parse(quoted.slice(1, -1).replaceAll("'\\''", "'"));
        return {
          exit_code: 0,
          output: JSON.stringify({
            schemaVersion: 1,
            decision: 'allow',
            expectedHead: payload.expectedHead,
            expectedBase: payload.expectedBase,
            headBranch: payload.request.head,
            requestDigest: digestOf(payload.request),
          }),
        };
      },
      poll: async () => ({ exit_code: 1, output: '' }),
      create: async (request: unknown) => {
        created.push(request);
        return { isError: true };
      },
    },
  };
}

// check-cloud-pr.ts と同じ直列化（キーの順を固定した JSON）の SHA-256。
const previewDigest = (request: typeof options.request) =>
  new Bun.CryptoHasher('sha256')
    .update(
      JSON.stringify({
        repository_full_name: request.repository_full_name,
        head: request.head,
        base: request.base,
        title: request.title,
        body: request.body,
        draft: request.draft,
      }),
    )
    .digest('hex');

describe('create-reviewed-pr の要求の照合', () => {
  test('事前チェックが返すハッシュで照合し、出力の上限を超える長い本文でも作成へ進む', async () => {
    const body = `本文😀\n${'x'.repeat(200_000)}`;
    const preflight = allowingPreflight(previewDigest);
    const result = await createReviewedPr(preflight.tools, {
      ...options,
      request: { ...options.request, body },
    });
    expect(result.status).toBe('creation-unverified');
    expect(preflight.created).toEqual([{ ...options.request, body }]);
  });

  test('ハッシュが送る要求と食い違えば作成しない', async () => {
    const preflight = allowingPreflight((request) =>
      previewDigest({ ...request, title: `${request.title} ` }),
    );
    const error: unknown = await createReviewedPr(preflight.tools, options).catch(
      (e: unknown) => e,
    );
    expect(String(error)).toContain('did not authorize this exact request');
    expect(preflight.created).toEqual([]);
  });

  test('空白・Unicode・+ を含む作業ツリーのパスも受け付け、改行を含むパスは拒否する', async () => {
    const preflight = allowingPreflight(previewDigest);
    const cwd = "/work/my repo+ü/ü's tree";
    await createReviewedPr(preflight.tools, { ...options, cwd });
    expect(preflight.commands[0]?.workdir).toBe(cwd);
    const error: unknown = await createReviewedPr(preflight.tools, {
      ...options,
      cwd: '/work/a\nb',
    }).catch((e: unknown) => e);
    expect(String(error)).toContain('An absolute worktree cwd');
  });
});
