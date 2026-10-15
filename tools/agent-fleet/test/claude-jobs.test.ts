import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectClaudeJobs, parseClaudeJob } from '../src/collect/claude-jobs';

const fixtures = join(import.meta.dir, 'fixtures', 'claude-jobs');

describe('collectClaudeJobs', () => {
  test('ディレクトリ配下の state.json を全部読み、壊れたものは飛ばす', async () => {
    const r = await collectClaudeJobs(fixtures);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.map((j) => j.id).sort()).toEqual(['job1', 'job2', 'job3']);
    const job1 = r.value.find((j) => j.id === 'job1')!;
    expect(job1.state).toBe('blocked');
    expect(job1.intent).toContain('ダミーの元の指示');
    expect(job1.worktreeBranch).toBe('feature-a');
    expect(job1.children).toEqual([{ id: '100', href: 'https://github.com/org/repo/pull/100', kind: 'pr' }]);
    expect(job1.createdAt).toBe(Date.parse('2026-09-04T02:37:16.702Z'));
    expect(job1.transcriptPath).toContain('11111111');
    expect(job1.model).toBe('claude-fable-5-1[1m]');
    const job2 = r.value.find((j) => j.id === 'job2')!;
    expect(job2.children).toEqual([]);
    expect(job2.outputResult).toContain('レビュー指摘');
    expect(job2.name).toBeNull();
    expect(job2.model).toBeNull();
    const job3 = r.value.find((j) => j.id === 'job3')!;
    expect(job3.children).toEqual([{ id: '1', href: 'https://x/pull/1', kind: 'pr' }]);
  });
  test('無いディレクトリは not_found', async () => {
    const r = await collectClaudeJobs(join(fixtures, 'nope'));
    if (!r.ok) expect(r.error.type).toBe('not_found');
    else throw new Error('should fail');
  });
  test('ディレクトリではなく通常ファイルを渡すと not_found', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'claude-jobs-'));
    const notADir = join(dir, 'not-a-dir');
    writeFileSync(notADir, 'plain file');
    const r = await collectClaudeJobs(notADir);
    if (!r.ok) expect(r.error.type).toBe('not_found');
    else throw new Error('should fail');
  });
});

describe('parseClaudeJob', () => {
  test('未知の state は unknown にする', () => {
    expect(parseClaudeJob('x', { state: 'paused', intent: 'a' })?.state).toBe('unknown');
  });
  test('object でなければ null', () => {
    expect(parseClaudeJob('x', 'nope')).toBeNull();
  });
  test('respawnFlags に toString を潰したオブジェクトが混じっても落ちず、文字列だけで --model を探す', () => {
    // { toString: 0 } は String() に渡すと変換できず例外になる（toString/valueOf が
    // どちらも呼び出し不能なプリミティブ変換）。フィルタで弾ければ例外は起きない。
    const raw = { state: 'working', respawnFlags: [{ toString: 0 }, '--model', 'sonnet'] };
    const job = parseClaudeJob('x', raw);
    expect(job?.model).toBe('sonnet');
  });
  test('child の id/kind が string/number 以外なら、その child だけ飛ばし他の正常な job は影響を受けない', () => {
    const malformed = parseClaudeJob('bad', {
      state: 'working',
      children: [{ id: { toString: 0 }, href: 'https://x/pull/1', kind: 'pr' }],
    });
    expect(malformed?.children).toEqual([]);
    const valid = parseClaudeJob('good', {
      state: 'working',
      children: [{ id: '1', href: 'https://x/pull/1', kind: 'pr' }],
    });
    expect(valid?.children).toEqual([{ id: '1', href: 'https://x/pull/1', kind: 'pr' }]);
  });
});
