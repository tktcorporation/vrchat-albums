import { describe, expect, test } from 'bun:test';
import { fail, ok } from '../src/collect/types';
import { createCollector, type CollectorDeps } from '../src/model/collector';

function deps(over: Partial<CollectorDeps>, counters: Record<string, number>): CollectorDeps {
  const count = (k: string) => { counters[k] = (counters[k] ?? 0) + 1; };
  let t = 0;
  return {
    workspaceRoot: '/workspaces/ws',
    now: () => (t += 1000),
    jobs: async () => { count('jobs'); return ok([]); },
    sessions: async () => { count('sessions'); return ok([]); },
    agentsCli: async () => { count('agentsCli'); return ok([]); },
    herdr: async () => { count('herdr'); return fail('not_running', 'no herdr'); },
    codex: async () => { count('codex'); return ok([]); },
    worktrees: async () => { count('worktrees'); return ok([]); },
    transcript: () => fail('not_found', 'x'),
    findTranscript: () => null,
    ...over,
  };
}

describe('createCollector', () => {
  test('源の失敗は sources に載り、行は空でも Snapshot を返す', async () => {
    const c = createCollector(deps({}, {}));
    const s = await c.collect();
    expect(s.rows).toEqual([]);
    expect(s.sources.herdr).toEqual({ type: 'not_running', detail: 'no herdr' });
    expect(s.sources.claudeJobs).toBeNull();
  });
  test('agentsCli は 10 秒、worktrees は 30 秒に 1 回しか呼ばない', async () => {
    const counters: Record<string, number> = {};
    const c = createCollector(deps({}, counters));
    for (let i = 0; i < 12; i++) await c.collect(); // now は 1 秒ずつ進む
    expect(counters.jobs).toBe(12);
    expect(counters.agentsCli).toBe(2);
    expect(counters.worktrees).toBe(1);
  });
  test('31 回呼んでも worktrees はちょうど 2 回（30 秒キャッシュの境界確認）', async () => {
    const counters: Record<string, number> = {};
    const c = createCollector(deps({}, counters));
    for (let i = 0; i < 31; i++) await c.collect();
    expect(counters.worktrees).toBe(2);
  });
  test('herdr が失敗しても jobs の行は残る', async () => {
    const c = createCollector(
      deps(
        {
          jobs: async () => ok([
            {
              id: 'job1', sessionId: null, name: 'design review', state: 'working', detail: null,
              intent: '指示', outputResult: null, cwd: '/workspaces/ws', worktreePath: null,
              worktreeBranch: null, children: [], createdAt: 1000, updatedAt: 2000, transcriptPath: null,
              model: 'sonnet',
            },
          ]),
        },
        {},
      ),
    );
    const s = await c.collect();
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0]?.key).toBe('claude-bg:job1');
  });
  test('Herdr の codex pane の thread id だけを codex に渡す', async () => {
    let asked: string[] = [];
    const c = createCollector(
      deps(
        {
          herdr: async () => ok([
            { paneId: 'w2:p1', workspaceId: 'w2', agent: 'codex', status: 'idle', cwd: '/x', name: null, title: null, sessionId: 'thread-1', stateChangeSeq: 1 },
            { paneId: 'w1:p1', workspaceId: 'w1', agent: 'claude', status: 'idle', cwd: '/y', name: null, title: null, sessionId: 's1', stateChangeSeq: 2 },
          ]),
          codex: async (ids) => { asked = ids; return ok([]); },
        },
        {},
      ),
    );
    await c.collect();
    expect(asked).toEqual(['thread-1']);
  });
  test('herdr が throw しても Snapshot を返し、sources.herdr に分類済みエラーが載る', async () => {
    const c = createCollector(
      deps(
        {
          herdr: async () => { throw new Error('boom'); },
        },
        {},
      ),
    );
    const s = await c.collect();
    expect(s.sources.herdr).toEqual({ type: 'not_running', detail: 'boom' });
  });
  test('herdr が Error 以外（null）を reject しても detail は "null" になる', async () => {
    const c = createCollector(
      deps(
        {
          herdr: async () => { throw null; },
        },
        {},
      ),
    );
    const s = await c.collect();
    expect(s.sources.herdr).toEqual({ type: 'not_running', detail: 'null' });
  });
  test('herdr が文字列を reject してもその文字列が detail になる', async () => {
    const c = createCollector(
      deps(
        {
          herdr: async () => { throw 'oops'; },
        },
        {},
      ),
    );
    const s = await c.collect();
    expect(s.sources.herdr).toEqual({ type: 'not_running', detail: 'oops' });
  });
  test('transcript が parse_error を返しても他の行は残り、sources.transcripts に集計される', async () => {
    const c = createCollector(
      deps(
        {
          sessions: async () => ok([
            { pid: 1, sessionId: 's1', kind: 'interactive', name: null, status: 'idle', cwd: '/x', jobId: null, startedAt: 1, updatedAt: 2 },
          ]),
          findTranscript: () => '/x/s1.jsonl',
          transcript: () => fail('parse_error', 'broken json'),
        },
        {},
      ),
    );
    const s = await c.collect();
    expect(s.rows).toHaveLength(1);
    expect(s.sources.transcripts).toEqual({ type: 'parse_error', detail: '1 件: broken json' });
  });
  test('transcript が io_error を返しても他の行は残り、not_found とは違い失敗として集計される', async () => {
    const c = createCollector(
      deps(
        {
          sessions: async () => ok([
            { pid: 1, sessionId: 's1', kind: 'interactive', name: null, status: 'idle', cwd: '/x', jobId: null, startedAt: 1, updatedAt: 2 },
          ]),
          findTranscript: () => '/x/s1.jsonl',
          transcript: () => fail('io_error', 'EISDIR'),
        },
        {},
      ),
    );
    const s = await c.collect();
    expect(s.rows).toHaveLength(1);
    expect(s.sources.transcripts).toEqual({ type: 'io_error', detail: '1 件: EISDIR' });
  });
  test('transcript が not_found（未作成）のときは sources.transcripts は null', async () => {
    const c = createCollector(
      deps(
        {
          sessions: async () => ok([
            { pid: 1, sessionId: 's1', kind: 'interactive', name: null, status: 'idle', cwd: '/x', jobId: null, startedAt: 1, updatedAt: 2 },
          ]),
          findTranscript: () => '/x/s1.jsonl',
          transcript: () => fail('not_found', 'no such file'),
        },
        {},
      ),
    );
    const s = await c.collect();
    expect(s.sources.transcripts).toBeNull();
  });
});
