import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pullsPayload, writeFakeGh } from './fake-gh.ts';

test('未解決スレッドがなくてもレビュー本文の変更要求を一度知らせる', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'stop-review-body-'));
  try {
    const bin = join(cwd, 'bin');
    const state = join(cwd, 'state');
    await Promise.all([mkdir(bin), mkdir(state)]);
    const git = Bun.spawnSync(['git', 'init', '-q'], { cwd });
    expect(git.exitCode).toBe(0);
    expect(
      Bun.spawnSync(['git', 'remote', 'add', 'origin', 'https://github.com/owner/repo.git'], {
        cwd,
      }).exitCode,
    ).toBe(0);
    await writeFakeGh(bin);
    const child = Bun.spawn(['bun', join(import.meta.dir, 'stop-pr-comments.ts')], {
      cwd,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        XDG_STATE_HOME: state,
        FAKE_GH_LOGIN: 'author',
        FAKE_GH_PULLS: pullsPayload(42, 'head'),
        FAKE_REVIEWS: JSON.stringify([
          [
            {
              id: 9,
              commit_id: 'head',
              submitted_at: '2026-09-23T00:00:00Z',
              state: 'CHANGES_REQUESTED',
              body: '設計を見直す',
              user: { login: 'reviewer' },
            },
          ],
        ]),
      },
      stdin: new Blob([JSON.stringify({ cwd, session_id: 'review-body' })]),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [code, output] = await Promise.all([child.exited, new Response(child.stdout).text()]);
    expect(code).toBe(0);
    expect(output).toContain('変更要求レビュー本文が 1 件');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
