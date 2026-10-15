import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { collectClaudeAgents, parseClaudeAgentsJson } from '../src/collect/claude-agents-cli';
import { ok, fail } from '../src/collect/types';

const text = await Bun.file(join(import.meta.dir, 'fixtures', 'claude-agents.json')).text();

describe('parseClaudeAgentsJson', () => {
  test('配列を entry に変換し、waitingFor を保つ', () => {
    const r = parseClaudeAgentsJson(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.length).toBe(3);
    const job1 = r.value.find((e) => e.id === 'job1')!;
    expect(job1.waitingFor).toBe('input needed');
    expect(job1.state).toBe('blocked');
    const done = r.value.find((e) => e.id === 'job2')!;
    expect(done.pid).toBeNull();
    expect(done.waitingFor).toBeNull();
  });
  test('配列でなければ parse_error', () => {
    const r = parseClaudeAgentsJson('{"nope":1}');
    if (!r.ok) expect(r.error.type).toBe('parse_error');
    else throw new Error('should fail');
  });
  test('配列内の不正な要素はスキップして正常な要素だけ返す', () => {
    const r = parseClaudeAgentsJson('[null, {"kind":"interactive"}, 5]');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.length).toBe(1);
    expect(r.value[0]!.kind).toBe('interactive');
  });
  test('配列要素中の配列（ネスト配列）はエントリ化せずスキップする', () => {
    const r = parseClaudeAgentsJson('[[], {"kind":"interactive","pid":1}]');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.length).toBe(1);
    expect(r.value[0]!.kind).toBe('interactive');
    expect(r.value[0]!.pid).toBe(1);
  });
  test('壊れた JSON テキストは parse_error', () => {
    const r = parseClaudeAgentsJson('{oops');
    if (!r.ok) expect(r.error.type).toBe('parse_error');
    else throw new Error('should fail');
  });
});

describe('collectClaudeAgents', () => {
  test('コマンドの失敗をそのまま返す', async () => {
    const r = await collectClaudeAgents(async () => fail('not_running', 'claude missing'));
    if (!r.ok) expect(r.error.detail).toBe('claude missing');
    else throw new Error('should fail');
  });
  test('コマンド出力を parse する', async () => {
    const r = await collectClaudeAgents(async () => ok(text));
    if (r.ok) expect(r.value.length).toBe(3);
    else throw new Error('should succeed');
  });
  test('runCommand へ渡す cmd と timeoutMs が仕様どおり', async () => {
    const captured: { cmd?: string[]; timeoutMs?: number } = {};
    await collectClaudeAgents(async (cmd, timeoutMs) => {
      captured.cmd = cmd;
      captured.timeoutMs = timeoutMs;
      return ok(text);
    });
    expect(captured.cmd).toEqual(['claude', 'agents', '--json', '--all']);
    expect(captured.timeoutMs).toBe(5000);
  });
});
