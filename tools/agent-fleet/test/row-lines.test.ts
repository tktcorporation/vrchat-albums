import { describe, expect, test } from 'bun:test';
import type { FleetRow } from '../src/model/row';
import { textWidth } from '../src/tui/format';
import { buildLine1, buildLine2, computeLine1Layout } from '../src/tui/row-lines';

const now = 10_000_000_000;
const row = (over: Partial<FleetRow>): FleetRow => ({
  key: 'k',
  agent: 'claude',
  kind: 'interactive',
  name: 'a session name',
  model: 'claude-fable-5-1[1m]',
  status: 'working',
  statusSource: 'herdr',
  statusNote: null,
  originalPrompt: null,
  latestPrompt: null,
  activity: '作業中の説明',
  pending: null,
  location: { cwd: '/w', display: '.claude/worktrees/some-feature', branch: 'feat/x', paneId: 'w1:p1' },
  artifacts: [],
  startedAt: now - 60_000,
  updatedAt: now - 5_000,
  doneMarker: null,
  attach: { type: 'focus', paneId: 'w1:p1' },
  ...over,
});

describe('computeLine1Layout / buildLine1', () => {
  test.each([32, 36, 40, 41, 42, 60, 80, 100, 120, 200])(
    '幅 %i では行1の表示幅が width - 1 以下（avail >= 32 ならちょうど width - 1）になる',
    (width) => {
      const line1 = buildLine1(row({}), width, now, false);
      expect(textWidth(line1.plain)).toBeLessThanOrEqual(width - 1);
      const avail = width - 1 - 5 - 2 - 24; // MARGIN + LEFT_WIDTH + GAP_WIDTH + RIGHT_WIDTH
      if (avail >= 32) expect(textWidth(line1.plain)).toBe(width - 1);
    },
  );

  test.each([32, 36, 40, 41])(
    '幅 %i（avail < 10 の極端に狭い端末）でも行1は truncateForce で width - 1 まで切られる',
    (width) => {
      const line1 = buildLine1(row({}), width, now, false);
      // avail が NAME_MIN_WIDTH_NARROW(10) を割り込むこの範囲では、name の下限確保と
      // 右ブロックの固定幅がぶつかって素の合計は width - 1 を超えるため、
      // buildLine1 側の truncateForce が効いて必ず width - 1 まで切り詰められる。
      expect(textWidth(line1.plain)).toBe(width - 1);
      expect(line1.plain.endsWith('…')).toBe(true);
    },
  );

  test('80/100/120 の avail・nameWidth・locationWidth は設計の式どおり', () => {
    expect(computeLine1Layout(80)).toEqual({ nameWidth: 26, locationWidth: 20 });
    expect(computeLine1Layout(100)).toEqual({ nameWidth: 37, locationWidth: 29 });
    expect(computeLine1Layout(120)).toEqual({ nameWidth: 40, locationWidth: 46 });
  });

  test('全角混じりの name でも行1の表示幅がそろう', () => {
    const wide = buildLine1(row({ name: '日本語の名前です' }), 100, now, false);
    const ascii = buildLine1(row({ name: 'ascii-name' }), 100, now, false);
    expect(textWidth(wide.plain)).toBe(99);
    expect(textWidth(ascii.plain)).toBe(99);
  });

  test('name・location とも全角混じりでも行1の表示幅は width - 1 のまま', () => {
    const wide = buildLine1(
      row({ name: '日本語のセッション名', location: { cwd: '/w', display: '.claude/worktrees/日本語ブランチ名', branch: null, paneId: null } }),
      100,
      now,
      false,
    );
    expect(textWidth(wide.plain)).toBe(99);
  });

  test('avail が小さい端末では location が消え、name に幅を譲る', () => {
    // avail = width - 1 - 5 - 2 - 24 = width - 32。32 未満になる境目は width < 64。
    const layout = computeLine1Layout(50);
    expect(layout.locationWidth).toBe(0);
    const line1 = buildLine1(row({}), 50, now, false);
    expect(line1.location).toBe('');
    // location が消えても行1全体の表示幅は width - 1 のまま。
    expect(textWidth(line1.plain)).toBe(49);
  });

  test('selected では cursor が ▶ になる', () => {
    const selected = buildLine1(row({}), 100, now, true);
    expect(selected.cursor).toBe(' ▶ ');
    const unselected = buildLine1(row({}), 100, now, false);
    expect(unselected.cursor).toBe('   ');
  });
});

describe('buildLine2', () => {
  test('pending がある行は 要判断: 接頭辞が付く', () => {
    const line2 = buildLine2(row({ status: 'blocked', pending: { kind: 'input needed', text: '期間はどれ？' } }), 100);
    expect(line2.summaryPrefix).toBe('要判断: ');
    expect(line2.summary).toBe('期間はどれ？');
  });

  test('done は 完了: 接頭辞が付く', () => {
    const line2 = buildLine2(row({ status: 'done', activity: '通知メールの分析' }), 100);
    expect(line2.summaryPrefix).toBe('完了: ');
    expect(line2.summary).toBe('通知メールの分析');
  });

  test('idle かつ activity が無ければ (idle) を出す', () => {
    const line2 = buildLine2(row({ status: 'idle', activity: null }), 100);
    expect(line2.summary).toBe('(idle)');
  });

  test('indent は行1の name 開始位置（LEFT_WIDTH=5）にそろう', () => {
    const line2 = buildLine2(row({}), 100);
    expect(textWidth(line2.indent)).toBe(5);
  });
});
