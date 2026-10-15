import { expect, test } from 'bun:test';
import { runCommand } from '../src/collect/exec';

test('成功した出力を返す', async () => {
  const r = await runCommand(['echo', 'hi'], 2000);
  expect(r).toEqual({ ok: true, value: 'hi\n' });
});

test('存在しないコマンドは not_running', async () => {
  const r = await runCommand(['definitely-not-a-command-xyz'], 2000);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.type).toBe('not_running');
});

test('timeout を超えると timeout', async () => {
  const r = await runCommand(['sleep', '5'], 200);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.type).toBe('timeout');
});

test('子プロセスがパイプを保持し続けても timeout で確定する', async () => {
  const start = Date.now();
  // バックグラウンドの sleep が標準出力の書き込み側を握ったまま親(sh)だけ kill されるケース。
  // kill() は直接の子にしか効かないので、ストリームの完了待ちでは締め切りを超えて待ってしまう。
  const r = await runCommand(['sh', '-c', 'sleep 5 & echo started; wait'], 200);
  const elapsed = Date.now() - start;
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.type).toBe('timeout');
  expect(elapsed).toBeLessThan(2000);
});

test('非ゼロ終了は not_running に stderr を添える', async () => {
  const r = await runCommand(['sh', '-c', 'echo boom >&2; exit 3'], 2000);
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.error.type).toBe('not_running');
    expect(r.error.detail).toContain('boom');
  } else throw new Error('should fail');
});
