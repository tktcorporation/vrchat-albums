import { describe, expect, test } from 'bun:test';
import { DONE_STALE_MS, groupRows } from '../src/model/group';
import type { FleetRow } from '../src/model/row';

const now = 10_000_000_000;
const row = (over: Partial<FleetRow>): FleetRow => ({
  key: over.key ?? 'k', agent: 'claude', kind: 'interactive', name: 'n', model: null, status: 'working', statusSource: 'herdr',
  statusNote: null, originalPrompt: null, latestPrompt: null, activity: null, pending: null,
  location: { cwd: '/', display: '.', branch: null, paneId: null }, artifacts: [], startedAt: null, updatedAt: now - 1000,
  doneMarker: null, attach: { type: 'hint', text: '' }, ...over,
});

describe('groupRows', () => {
  test('blocked と未確認の done は要対応、確認済みの done と failed/stopped はその他', () => {
    const g = groupRows(
      [
        row({ key: 'b', status: 'blocked' }),
        row({ key: 'd1', status: 'done', doneMarker: '1' }),
        row({ key: 'd2', status: 'done', doneMarker: '2' }),
        row({ key: 'f', status: 'failed' }),
        row({ key: 's', status: 'stopped' }),
        row({ key: 'w', status: 'working' }),
        row({ key: 'i', status: 'idle' }),
      ],
      { d2: '2' },
      now,
    );
    expect(g.pending.map((r) => r.key)).toEqual(['b', 'd1']);
    expect(g.working.map((r) => r.key)).toEqual(['w']);
    expect(g.idle.map((r) => r.key)).toEqual(['i']);
    expect(g.other.map((r) => r.key)).toEqual(['d2', 'f', 's']);
  });
  test('7 日より古い done は確認済み扱いでその他へ。ちょうど7日は境界内（厳密な超過のみstale）', () => {
    const g = groupRows(
      [
        row({ key: 'old', status: 'done', doneMarker: '1', updatedAt: now - DONE_STALE_MS - 1 }),
        row({ key: 'boundary', status: 'done', doneMarker: '2', updatedAt: now - DONE_STALE_MS }),
      ],
      {},
      now,
    );
    expect(g.pending.map((r) => r.key)).toEqual(['boundary']);
    expect(g.other.map((r) => r.key)).toEqual(['old']);
  });
  test('updatedAt が null な done は stale 判定できないため pending のまま', () => {
    const g = groupRows([row({ key: 'no-time', status: 'done', doneMarker: '1', updatedAt: null })], {}, now);
    expect(g.pending.map((r) => r.key)).toEqual(['no-time']);
    expect(g.other.length).toBe(0);
  });
  test('要対応は待ち始めが古い順、作業中は更新が新しい順', () => {
    const g = groupRows(
      [
        row({ key: 'b-new', status: 'blocked', updatedAt: now - 10 }),
        row({ key: 'b-old', status: 'blocked', updatedAt: now - 500 }),
        row({ key: 'w-old', status: 'working', updatedAt: now - 500 }),
        row({ key: 'w-new', status: 'working', updatedAt: now - 10 }),
      ],
      {},
      now,
    );
    expect(g.pending.map((r) => r.key)).toEqual(['b-old', 'b-new']);
    expect(g.working.map((r) => r.key)).toEqual(['w-new', 'w-old']);
  });
});
