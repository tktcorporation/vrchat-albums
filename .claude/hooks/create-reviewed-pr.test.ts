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
