import { describe, expect, test } from 'bun:test';
import { fail, ok } from '../src/collect/types';
import type { FleetRow } from '../src/model/row';
import { openRow } from '../src/tui/actions';

const row = (attach: FleetRow['attach']): FleetRow => ({
  key: 'k', agent: 'claude', kind: 'background', name: 'n', model: null, status: 'working', statusSource: 'job',
  statusNote: null, originalPrompt: null, latestPrompt: null, activity: null, pending: null,
  location: { cwd: '/', display: '.', branch: null, paneId: null }, artifacts: [], startedAt: null, updatedAt: null, doneMarker: null, attach,
});

describe('openRow', () => {
  test('focus は herdr agent focus を呼ぶ', async () => {
    const calls: string[][] = [];
    const msg = await openRow(row({ type: 'focus', paneId: 'w1:p1' }), async (cmd) => { calls.push(cmd); return ok('{}'); });
    expect(calls).toEqual([['herdr', 'agent', 'focus', 'w1:p1']]);
    expect(msg).toContain('w1:p1');
  });

  test('claude-attach は現在の workspace に tab を作って claude attach を走らせる', async () => {
    const calls: string[][] = [];
    const run = async (cmd: string[]) => {
      calls.push(cmd);
      return cmd[1] === 'tab' ? ok(JSON.stringify({ result: { root_pane: { pane_id: 'w1:p9' } } })) : ok('{}');
    };
    const msg = await openRow(row({ type: 'claude-attach', jobId: 'job1' }), run, { HERDR_WORKSPACE_ID: 'w1', HERDR_ENV: '1' });
    expect(calls[0]).toEqual(['herdr', 'tab', 'create', '--workspace', 'w1', '--no-focus']);
    expect(calls[1]).toEqual(['herdr', 'pane', 'run', 'w1:p9', 'claude attach job1']);
    expect(msg).toContain('job1');
  });

  test('Herdr の外では claude-attach のコマンドを案内するだけで実行しない', async () => {
    const calls: string[][] = [];
    const msg = await openRow(row({ type: 'claude-attach', jobId: 'job1' }), async (cmd) => { calls.push(cmd); return ok(''); }, {});
    expect(msg).toBe('Herdr の外なので自動では開けない。別の端末で: claude attach job1');
    expect(calls).toEqual([]);
  });

  test('HERDR_ENV はあっても workspace id が無ければ案内するだけで実行しない', async () => {
    const calls: string[][] = [];
    const msg = await openRow(row({ type: 'claude-attach', jobId: 'job1' }), async (cmd) => { calls.push(cmd); return ok(''); }, { HERDR_ENV: '1' });
    expect(msg).toBe('Herdr の外なので自動では開けない。別の端末で: claude attach job1');
    expect(calls).toEqual([]);
  });

  test('hint はその文面を返し、何も実行しない', async () => {
    const calls: string[][] = [];
    const msg = await openRow(row({ type: 'hint', text: 'claude --resume x' }), async (cmd) => { calls.push(cmd); return ok(''); }, {});
    expect(msg).toBe('claude --resume x');
    expect(calls).toEqual([]);
  });

  test('herdr が失敗したら理由を返す', async () => {
    const msg = await openRow(row({ type: 'focus', paneId: 'w1:p1' }), async () => fail('not_running', 'no herdr'));
    expect(msg).toContain('no herdr');
  });

  test('不正な jobId は herdr を呼ばずに案内する（空白）', async () => {
    const calls: string[][] = [];
    const msg = await openRow(row({ type: 'claude-attach', jobId: 'job 1' }), async (cmd) => { calls.push(cmd); return ok(''); }, { HERDR_WORKSPACE_ID: 'w1', HERDR_ENV: '1' });
    expect(msg).toBe('不正なセッション id なので開けない: job 1');
    expect(calls).toEqual([]);
  });

  test('不正な jobId は herdr を呼ばずに案内する（シェル特殊文字）', async () => {
    const calls: string[][] = [];
    const msg = await openRow(row({ type: 'claude-attach', jobId: 'a;rm' }), async (cmd) => { calls.push(cmd); return ok(''); }, { HERDR_WORKSPACE_ID: 'w1', HERDR_ENV: '1' });
    expect(msg).toBe('不正なセッション id なので開けない: a;rm');
    expect(calls).toEqual([]);
  });

  test('tab 作成が失敗したら詳細を返し、pane run は呼ばない', async () => {
    const calls: string[][] = [];
    const run = async (cmd: string[]) => {
      calls.push(cmd);
      return fail<string>('not_running', 'no herdr binary');
    };
    const msg = await openRow(row({ type: 'claude-attach', jobId: 'job1' }), run, { HERDR_WORKSPACE_ID: 'w1', HERDR_ENV: '1' });
    expect(msg).toContain('no herdr binary');
    expect(calls).toEqual([['herdr', 'tab', 'create', '--workspace', 'w1', '--no-focus']]);
  });

  test('tab の応答から pane id が読めなければ pane run は呼ばない', async () => {
    const calls: string[][] = [];
    const run = async (cmd: string[]) => {
      calls.push(cmd);
      return ok<string>('null');
    };
    const msg = await openRow(row({ type: 'claude-attach', jobId: 'job1' }), run, { HERDR_WORKSPACE_ID: 'w1', HERDR_ENV: '1' });
    expect(msg).toBe('tab は作れたが pane id が読めない');
    expect(calls).toEqual([['herdr', 'tab', 'create', '--workspace', 'w1', '--no-focus']]);
  });

  test('pane run が失敗したら詳細を返す', async () => {
    const calls: string[][] = [];
    const run = async (cmd: string[]) => {
      calls.push(cmd);
      if (cmd[1] === 'tab') return ok<string>(JSON.stringify({ result: { root_pane: { pane_id: 'w1:p9' } } }));
      return fail<string>('timeout', 'pane run が応答しなかった');
    };
    const msg = await openRow(row({ type: 'claude-attach', jobId: 'job1' }), run, { HERDR_WORKSPACE_ID: 'w1', HERDR_ENV: '1' });
    expect(msg).toContain('pane run が応答しなかった');
    expect(calls[1]).toEqual(['herdr', 'pane', 'run', 'w1:p9', 'claude attach job1']);
  });
});

describe('paneIdFromTabCreate (openRow 経由)', () => {
  const runWithTabResponse = (json: string) => async (cmd: string[]) => (cmd[1] === 'tab' ? ok(json) : ok(''));

  test('null は pane id が読めない扱いになる', async () => {
    const msg = await openRow(row({ type: 'claude-attach', jobId: 'job1' }), runWithTabResponse('null'), { HERDR_WORKSPACE_ID: 'w1', HERDR_ENV: '1' });
    expect(msg).toBe('tab は作れたが pane id が読めない');
  });

  test('配列は pane id が読めない扱いになる', async () => {
    const msg = await openRow(row({ type: 'claude-attach', jobId: 'job1' }), runWithTabResponse('[]'), { HERDR_WORKSPACE_ID: 'w1', HERDR_ENV: '1' });
    expect(msg).toBe('tab は作れたが pane id が読めない');
  });

  test('構文エラーな JSON は pane id が読めない扱いになる', async () => {
    const msg = await openRow(row({ type: 'claude-attach', jobId: 'job1' }), runWithTabResponse('{oops'), { HERDR_WORKSPACE_ID: 'w1', HERDR_ENV: '1' });
    expect(msg).toBe('tab は作れたが pane id が読めない');
  });

  test('正しい形なら pane id を読んで pane run を呼ぶ', async () => {
    const calls: string[][] = [];
    const run = async (cmd: string[]) => {
      calls.push(cmd);
      return cmd[1] === 'tab' ? ok('{"result":{"root_pane":{"pane_id":"w1:p9"}}}') : ok('{}');
    };
    const msg = await openRow(row({ type: 'claude-attach', jobId: 'job1' }), run, { HERDR_WORKSPACE_ID: 'w1', HERDR_ENV: '1' });
    expect(calls[1]).toEqual(['herdr', 'pane', 'run', 'w1:p9', 'claude attach job1']);
    expect(msg).toContain('w1:p9');
  });
});
