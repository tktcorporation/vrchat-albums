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
  test('確かめられない push は警告して通し、コネクタ側ゲートの許可がある HEAD は 1 回だけ警告なしで通す', async () => {
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
        const [code, output] = await Promise.all([child.exited, new Response(child.stdout).text()]);
        return { code, warned: output.includes('WARNING') };
      };
      const branch = await currentBranch(cwd);
      const sha = await reviewTargetSha({ cwd });

      const warned = { code: 0, warned: true };
      expect(await run()).toEqual(warned);

      await writeCloudPushGrant({ cwd }, { branch, head: 'b'.repeat(40) });
      expect(await run()).toEqual(warned);

      await writeCloudPushGrant({ cwd }, { branch, head: sha });
      expect(await run()).toEqual({ code: 0, warned: false });
      // 使った許可は消えるので、2 回目の push は再び警告する。
      expect(await run()).toEqual(warned);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
