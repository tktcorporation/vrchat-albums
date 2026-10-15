import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { collectHerdrAgents, parseHerdrAgentList } from '../src/collect/herdr';
import { fail, ok } from '../src/collect/types';

const text = await Bun.file(join(import.meta.dir, 'fixtures', 'herdr-agent-list.json')).text();

describe('parseHerdrAgentList', () => {
  test('pane ごとの agent / status / session id を取る', () => {
    const r = parseHerdrAgentList(text);
    if (!r.ok) throw new Error(`expected ok, got error: ${r.error.type} ${r.error.detail}`);
    expect(r.value.length).toBe(3);
    expect(r.value[0]).toMatchObject({
      paneId: 'w1:p1',
      agent: 'claude',
      status: 'working',
      sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      stateChangeSeq: 543,
    });
    expect(r.value[1]).toMatchObject({ agent: 'codex', sessionId: 'thread-child' });
    expect(r.value[2]).toMatchObject({ sessionId: null, name: 'writer', title: '9月目標の執筆', status: 'done' });
  });

  test('未知の status は unknown', () => {
    const r = parseHerdrAgentList(
      '{"result":{"agents":[{"agent":"claude","agent_status":"weird","cwd":"/","pane_id":"w1:p1","workspace_id":"w1"}]}}',
    );
    if (!r.ok) throw new Error(`expected ok, got error: ${r.error.type} ${r.error.detail}`);
    expect(r.value[0]?.status).toBe('unknown');
  });

  test('agents 配列が無ければ parse_error', () => {
    const r = parseHerdrAgentList('{"result":{}}');
    if (r.ok) throw new Error('should fail');
    expect(r.error.type).toBe('parse_error');
  });

  test('JSON として壊れていれば parse_error', () => {
    const r = parseHerdrAgentList('{not json');
    if (r.ok) throw new Error('should fail');
    expect(r.error.type).toBe('parse_error');
  });

  test('result / agents が無い・null の形でも parse_error（例外を投げない）', () => {
    const r1 = parseHerdrAgentList('{"result":null}');
    const r2 = parseHerdrAgentList('{}');
    if (r1.ok || r2.ok) throw new Error('should fail');
    expect(r1.error.type).toBe('parse_error');
    expect(r2.error.type).toBe('parse_error');
  });

  test('agents が空配列なら ok([])', () => {
    const r = parseHerdrAgentList('{"result":{"agents":[]}}');
    if (!r.ok) throw new Error(`expected ok, got error: ${r.error.type} ${r.error.detail}`);
    expect(r.value).toEqual([]);
  });

  test('壊れた要素（null / 配列 / paneId や cwd 欠落）は無視し、有効な要素だけ返す', () => {
    const r = parseHerdrAgentList(
      JSON.stringify({
        result: {
          agents: [
            null,
            [],
            { agent: 'claude', agent_status: 'working', cwd: '/ws', workspace_id: 'w1' }, // pane_id 欠落
            { agent: 'claude', agent_status: 'working', pane_id: 'w2:p1', workspace_id: 'w2' }, // cwd 欠落
            { agent: 'claude', agent_status: 'working', cwd: '', pane_id: 'w3:p1', workspace_id: 'w3' }, // cwd 空文字
            { agent: 'claude', agent_status: 'working', cwd: '/ws', pane_id: 'w1:p1', workspace_id: 'w1' },
          ],
        },
      }),
    );
    if (!r.ok) throw new Error(`expected ok, got error: ${r.error.type} ${r.error.detail}`);
    expect(r.value.length).toBe(1);
    expect(r.value[0]).toMatchObject({ paneId: 'w1:p1', agent: 'claude', status: 'working' });
  });

  test('agent_session が非オブジェクト・value が非文字列なら sessionId は null', () => {
    const r = parseHerdrAgentList(
      JSON.stringify({
        result: {
          agents: [
            {
              agent: 'claude',
              agent_status: 'working',
              cwd: '/ws',
              pane_id: 'w1:p1',
              workspace_id: 'w1',
              agent_session: [],
            },
            {
              agent: 'claude',
              agent_status: 'working',
              cwd: '/ws',
              pane_id: 'w2:p1',
              workspace_id: 'w2',
              agent_session: { value: 42 },
            },
          ],
        },
      }),
    );
    if (!r.ok) throw new Error(`expected ok, got error: ${r.error.type} ${r.error.detail}`);
    expect(r.value[0]?.sessionId).toBeNull();
    expect(r.value[1]?.sessionId).toBeNull();
  });
});

describe('collectHerdrAgents', () => {
  test('herdr が無ければ not_running をそのまま返す', async () => {
    const r = await collectHerdrAgents(async () => fail('not_running', 'no herdr'));
    if (r.ok) throw new Error('should fail');
    expect(r.error.type).toBe('not_running');
  });

  test('timeout もそのまま伝播する', async () => {
    const r = await collectHerdrAgents(async () => fail('timeout', 'herdr agent list が 3000ms で応答しなかった'));
    if (r.ok) throw new Error('should fail');
    expect(r.error).toEqual({ type: 'timeout', detail: 'herdr agent list が 3000ms で応答しなかった' });
  });

  test('出力を parse する', async () => {
    const r = await collectHerdrAgents(async () => ok(text));
    if (!r.ok) throw new Error(`expected ok, got error: ${r.error.type} ${r.error.detail}`);
    expect(r.value.length).toBe(3);
  });

  test('herdr agent list を timeout 3000ms で実行する', async () => {
    const calls: [string[], number][] = [];
    const run = async (cmd: string[], timeoutMs: number) => {
      calls.push([cmd, timeoutMs]);
      return ok(text);
    };
    await collectHerdrAgents(run);
    expect(calls).toEqual([[['herdr', 'agent', 'list'], 3000]]);
  });
});
