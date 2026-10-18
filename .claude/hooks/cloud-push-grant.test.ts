import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkCloudPushGrant, writeCloudPushGrant } from './cloud-push-grant.ts';
import { currentBranch } from './hook-utils.ts';
import { reviewTargetSha } from './review-count.ts';

const script = join(import.meta.dir, 'require-pr-feedback-review.ts');
const head = 'a'.repeat(40);
const grant = (fields: Record<string, unknown>) =>
  JSON.stringify({ branch: 'feature', head, expiresAt: 1_000, ...fields });

describe('checkCloudPushGrant', () => {
  test('同じブランチと HEAD への期限内の許可だけを通す', () => {
    expect(checkCloudPushGrant(grant({}), { branch: 'feature', head, now: 1_000 })).toBeNull();
    expect(checkCloudPushGrant(grant({}), { branch: 'feature', head, now: 1_001 })).toContain(
      '期限',
    );
    expect(checkCloudPushGrant(grant({}), { branch: 'other', head, now: 0 })).toContain('一致');
    expect(
      checkCloudPushGrant(grant({}), { branch: 'feature', head: 'b'.repeat(40), now: 0 }),
    ).toContain('一致');
  });

  test('壊れた記録は許可として扱わない', () => {
    const target = { branch: 'feature', head, now: 0 };
    expect(checkCloudPushGrant('not json', target)).toContain('読み取れません');
    expect(checkCloudPushGrant('[]', target)).toContain('読み取れません');
    expect(checkCloudPushGrant(grant({ expiresAt: '9999' }), target)).toContain('読み取れません');
  });
});

describe('gh が使えない環境の外部指摘 push ガード', () => {
  test('コネクタ側ゲートの許可がある HEAD だけを 1 回通す', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'cloud-push-grant-'));
    try {
      for (const args of [
        ['init', '-q'],
        ['config', 'user.name', 'Test'],
        ['config', 'user.email', 'test@example.com'],
      ])
        expect(Bun.spawnSync(['git', ...args], { cwd }).exitCode).toBe(0);
      await writeFile(join(cwd, 'README'), 'test');
      expect(Bun.spawnSync(['git', 'add', 'README'], { cwd }).exitCode).toBe(0);
      expect(Bun.spawnSync(['git', 'commit', '-qm', 'test'], { cwd }).exitCode).toBe(0);
      const bin = join(cwd, 'bin');
      await mkdir(bin);
      // 認証できない gh は PR を引けず、"no pull requests found" 以外のエラーを返す。
      await writeFile(join(bin, 'gh'), '#!/bin/sh\necho "authentication required" >&2\nexit 1\n', {
        mode: 0o755,
      });
      const run = async () => {
        const child = Bun.spawn(['bun', script], {
          cwd,
          env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
          stdin: new Blob([JSON.stringify({ cwd })]),
          stdout: 'pipe',
          stderr: 'pipe',
        });
        const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
        return { code, error };
      };
      const branch = await currentBranch(cwd);
      const sha = await reviewTargetSha({ cwd });

      expect((await run()).code).toBe(2);

      await writeCloudPushGrant({ cwd }, { branch, head: 'b'.repeat(40) });
      const mismatch = await run();
      expect(mismatch.code).toBe(2);
      expect(mismatch.error).toContain('一致しません');

      await writeCloudPushGrant({ cwd }, { branch, head: sha });
      expect((await run()).code).toBe(0);
      // 使った許可は消えるので、同じ許可で 2 回目の push は通らない。
      expect((await run()).code).toBe(2);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
