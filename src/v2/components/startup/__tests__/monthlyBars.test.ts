import { describe, expect, it } from 'vitest';

import {
  fillMonthRange,
  toMonthBars,
  yearMonthOf,
  yearSpans,
} from '../monthlyBars';

describe('fillMonthRange', () => {
  it('写真の無い月を 0 枚で埋め、今月まで並べる', () => {
    const filled = fillMonthRange(
      [
        { month: '2024-11', count: 3 },
        { month: '2025-02', count: 5 },
      ],
      '2025-04',
    );
    expect(filled).toEqual([
      { month: '2024-11', count: 3 },
      { month: '2024-12', count: 0 },
      { month: '2025-01', count: 0 },
      { month: '2025-02', count: 5 },
      { month: '2025-03', count: 0 },
      { month: '2025-04', count: 0 },
    ]);
  });

  it('統計に月が無ければ空の並びを返す', () => {
    expect(fillMonthRange([], '2025-04')).toEqual([]);
  });

  it('写真が今月だけなら 1 本だけになる', () => {
    expect(fillMonthRange([{ month: '2025-04', count: 7 }], '2025-04')).toEqual(
      [{ month: '2025-04', count: 7 }],
    );
  });

  it('写真の月が今月より後なら、その月までを並べる', () => {
    const filled = fillMonthRange(
      [
        { month: '2025-03', count: 1 },
        { month: '2025-06', count: 2 },
      ],
      '2025-04',
    );
    expect(filled.map((m) => m.month)).toEqual([
      '2025-03',
      '2025-04',
      '2025-05',
      '2025-06',
    ]);
  });

  it('10 年分でも月を 1 つも飛ばさない', () => {
    const filled = fillMonthRange([{ month: '2015-11', count: 1 }], '2025-10');
    expect(filled).toHaveLength(120);
    expect(filled.at(0)?.month).toBe('2015-11');
    expect(filled.at(-1)?.month).toBe('2025-10');
  });
});

describe('yearSpans', () => {
  it('年ごとに開始位置と月数をまとめる', () => {
    expect(
      yearSpans(['2024-11', '2024-12', '2025-01', '2025-02', '2025-03']),
    ).toEqual([
      { year: '2024', start: 0, span: 2 },
      { year: '2025', start: 2, span: 3 },
    ]);
  });

  it('月が無ければラベルも無い', () => {
    expect(yearSpans([])).toEqual([]);
  });

  it('120 か月は 11 年に分かれ、月数の合計が一致する', () => {
    const months = fillMonthRange(
      [{ month: '2015-11', count: 1 }],
      '2025-10',
    ).map((m) => m.month);
    const spans = yearSpans(months);
    expect(spans).toHaveLength(11);
    expect(spans.reduce((sum, s) => sum + s.span, 0)).toBe(120);
    expect(spans.at(0)).toEqual({ year: '2015', start: 0, span: 2 });
    expect(spans.at(-1)).toEqual({ year: '2025', start: 110, span: 10 });
  });
});

describe('toMonthBars', () => {
  it('最大枚数の月を 1 として高さの比を出す', () => {
    const bars = toMonthBars(
      [
        { month: '2025-01', count: 50 },
        { month: '2025-02', count: 0 },
        { month: '2025-03', count: 200 },
      ],
      null,
    );
    expect(bars.map((b) => b.ratio)).toEqual([0.25, 0, 1]);
    expect(bars.map((b) => b.tone)).toEqual(['counted', 'empty', 'counted']);
  });

  it('処理中の月は枚数に関わらず current になる', () => {
    const bars = toMonthBars(
      [
        { month: '2025-01', count: 5 },
        { month: '2025-02', count: 0 },
      ],
      '2025-02',
    );
    expect(bars.map((b) => b.tone)).toEqual(['counted', 'current']);
  });

  it('1 本だけでも比は 1 になる', () => {
    expect(toMonthBars([{ month: '2025-01', count: 9 }], null)).toEqual([
      { month: '2025-01', count: 9, ratio: 1, tone: 'counted' },
    ]);
  });

  it('全部 0 枚でも割り算で壊れない', () => {
    const bars = toMonthBars(
      [
        { month: '2025-01', count: 0 },
        { month: '2025-02', count: 0 },
      ],
      null,
    );
    expect(bars.map((b) => b.ratio)).toEqual([0, 0]);
  });

  it('120 本すべてが 0〜1 の比に収まる', () => {
    const months = fillMonthRange(
      [
        { month: '2015-11', count: 4 },
        { month: '2020-05', count: 400 },
      ],
      '2025-10',
    );
    const bars = toMonthBars(months, '2020-05');
    expect(bars).toHaveLength(120);
    expect(bars.every((b) => b.ratio >= 0 && b.ratio <= 1)).toBe(true);
    expect(bars.filter((b) => b.tone === 'current')).toHaveLength(1);
  });
});

describe('yearMonthOf', () => {
  it('ローカルタイムの年月をゼロ埋めで返す', () => {
    expect(yearMonthOf(new Date(2025, 0, 31, 23, 59))).toBe('2025-01');
  });
});
