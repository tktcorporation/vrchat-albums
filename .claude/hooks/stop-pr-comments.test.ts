import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('未解決スレッドがなくてもレビュー本文の変更要求を一度知らせる', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'stop-review-body-'));
  try {
    const bin = join(cwd, 'bin');
    const state = join(cwd, 'state');
    await Promise.all([mkdir(bin), mkdir(state)]);
    const git = Bun.spawnSync(['git', 'init', '-q'], { cwd });
    expect(git.exitCode).toBe(0);
    await writeFile(join(bin, 'gh'), `#!/bin/sh
if [ "$1" = "pr" ]; then printf '{"number":42,"url":"https://example.test/pr/42","headRefOid":"head"}\\n'; exit 0; fi
if [ "$1" = "repo" ]; then printf 'owner/repo\\n'; exit 0; fi
if [ "$1" = "api" ] && [ "$2" = "user" ]; then printf 'author\\n'; exit 0; fi
if [ "$1" = "api" ] && [ "$2" = "graphql" ]; then printf '{"data":{"repository":{"pullRequest":{"reviewThreads":{"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}}\\n'; exit 0; fi
if [ "$1" = "api" ]; then case "$2" in */reviews?*) printf '[[{"id":9,"commit_id":"head","submitted_at":"2026-09-23T00:00:00Z","state":"CHANGES_REQUESTED","body":"設計を見直す","user":{"login":"reviewer"}}]]\\n';; *) printf '[[]]\\n';; esac; exit 0; fi
exit 1
`, { mode: 0o755 });
    const child = Bun.spawn(['bun', join(import.meta.dir, 'stop-pr-comments.ts')], {
      cwd,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, XDG_STATE_HOME: state },
      stdin: new Blob([JSON.stringify({ cwd, session_id: 'review-body' })]),
      stdout: 'pipe', stderr: 'pipe',
    });
    const [code, output] = await Promise.all([child.exited, new Response(child.stdout).text()]);
    expect(code).toBe(0);
    expect(output).toContain('変更要求レビュー本文が 1 件');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
