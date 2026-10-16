import { describe, expect, it } from 'vitest';

import {
  centerYearOf,
  chartMonthOf,
  FILL_STEPS,
  fillMonthRange,
  fillStepOf,
  ringGeometry,
  sectorPath,
  toYearRings,
  yearMonthOf,
} from '../photoRings';

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

  it('今月より後の月は並べず、その枚数を今月の棒に足す', () => {
    const filled = fillMonthRange(
      [
        { month: '2025-03', count: 1 },
        { month: '2025-04', count: 4 },
        { month: '2025-06', count: 2 },
        { month: '2099-01', count: 3 },
      ],
      '2025-04',
    );
    expect(filled).toEqual([
      { month: '2025-03', count: 1 },
      { month: '2025-04', count: 9 },
    ]);
  });

  it('写真がすべて今月より後の月なら、今月の 1 本にまとめる', () => {
    expect(fillMonthRange([{ month: '2099-12', count: 5 }], '2025-04')).toEqual(
      [{ month: '2025-04', count: 5 }],
    );
  });

  it('10 年分でも月を 1 つも飛ばさない', () => {
    const filled = fillMonthRange([{ month: '2017-11', count: 1 }], '2027-10');
    expect(filled).toHaveLength(120);
    expect(filled.at(0)?.month).toBe('2017-11');
    expect(filled.at(-1)?.month).toBe('2027-10');
  });

  it('2017-01 より前の月は並べず、その枚数を左端の 2017-01 の棒に足す', () => {
    const filled = fillMonthRange(
      [
        { month: '1970-01', count: 3 },
        { month: '2016-12', count: 2 },
        { month: '2017-01', count: 1 },
        { month: '2017-03', count: 4 },
      ],
      '2017-04',
    );
    expect(filled).toEqual([
      { month: '2017-01', count: 6 },
      { month: '2017-02', count: 0 },
      { month: '2017-03', count: 4 },
      { month: '2017-04', count: 0 },
    ]);
  });

  it('古い外れ値の月が 1 つあっても、左端は 2017-01 で止まる', () => {
    const filled = fillMonthRange(
      [
        { month: '1970-01', count: 1 },
        { month: '2024-06', count: 10 },
      ],
      '2025-04',
    );
    expect(filled.at(0)).toEqual({ month: '2017-01', count: 1 });
    expect(filled).toHaveLength(100);
  });
});

describe('chartMonthOf', () => {
  it('範囲内の月はそのまま返す', () => {
    expect(chartMonthOf('2024-08', '2025-04')).toBe('2024-08');
  });

  it('今月より後の月は今月に寄せる', () => {
    expect(chartMonthOf('2099-12', '2025-04')).toBe('2025-04');
  });

  it('2017-01 より前の月は 2017-01 に寄せる', () => {
    expect(chartMonthOf('1970-01', '2025-04')).toBe('2017-01');
  });

  it('今月が 2017-01 より前（端末の時計の誤り）なら、すべて今月に寄せる', () => {
    expect(chartMonthOf('1970-01', '2010-05')).toBe('2010-05');
    expect(chartMonthOf('2024-08', '2010-05')).toBe('2010-05');
  });
});

describe('fillStepOf', () => {
  it('写真が無い月は 0、最も多い月は最大段階になる', () => {
    expect(fillStepOf(0, 200)).toBe(0);
    expect(fillStepOf(200, 200)).toBe(FILL_STEPS);
  });

  it('1 枚でもあれば最も薄い段階 1 にして、0 枚と見分けられるようにする', () => {
    expect(fillStepOf(1, 10_000)).toBe(1);
  });

  it('最大枚数との比を段階に切り上げる', () => {
    expect([40, 41, 80, 120, 160, 199].map((c) => fillStepOf(c, 200))).toEqual([
      1, 2, 2, 3, 4, 5,
    ]);
  });

  it('最大が 0 でも割り算で壊れない', () => {
    expect(fillStepOf(0, 0)).toBe(0);
  });
});

describe('toYearRings', () => {
  const months = [
    { month: '2023-11', count: 50 },
    { month: '2025-03', count: 200 },
  ];

  it('最初の写真の年から今年までを、古い年から順に 12 区画ずつ並べる', () => {
    const rings = toYearRings(months, '2025-04', null);
    expect(rings.map((r) => r.year)).toEqual(['2023', '2024', '2025']);
    expect(rings.every((r) => r.sectors.length === 12)).toBe(true);
    expect(rings[0].sectors[0].month).toBe('2023-01');
    expect(rings[2].sectors[11].month).toBe('2025-12');
  });

  it('区画の位置は月で決まり（0 = 1 月）、塗りの段階は最も多い月を基準にする', () => {
    const rings = toYearRings(months, '2025-04', null);
    expect(rings[0].sectors[10]).toEqual({
      month: '2023-11',
      count: 50,
      step: 2,
      tone: 'counted',
    });
    expect(rings[2].sectors[2]).toMatchObject({ step: FILL_STEPS });
  });

  it('最初の写真より前の月と写真の無い月は empty、今月より後の月は future になる', () => {
    const rings = toYearRings(months, '2025-04', null);
    expect(rings[0].sectors[0].tone).toBe('empty');
    expect(rings[1].sectors[5]).toMatchObject({ tone: 'empty', step: 0 });
    expect(rings[2].sectors.map((s) => s.tone)).toEqual([
      'empty',
      'empty',
      'counted',
      'empty',
      ...Array.from({ length: 8 }, () => 'future'),
    ]);
  });

  it('処理中の月は枚数に関わらず current になり、ほかに current は無い', () => {
    const rings = toYearRings(months, '2025-04', '2024-06');
    const current = rings
      .flatMap((r) => r.sectors)
      .filter((s) => s.tone === 'current');
    expect(current.map((s) => s.month)).toEqual(['2024-06']);
  });

  it('今月より後の撮影月は今月に寄せ、その区画を処理中として強調できる', () => {
    const highlight = chartMonthOf('2099-12', '2025-04');
    const rings = toYearRings(
      [...months, { month: '2099-12', count: 7 }],
      '2025-04',
      highlight,
    );
    expect(rings.at(-1)?.year).toBe('2025');
    expect(rings.at(-1)?.sectors[3]).toMatchObject({
      month: '2025-04',
      count: 7,
      tone: 'current',
    });
  });

  it('写真が 1 枚も無ければ今年の空の輪を 1 周だけ返す', () => {
    const rings = toYearRings([], '2025-04', null);
    expect(rings).toHaveLength(1);
    expect(rings[0].year).toBe('2025');
    expect(rings[0].sectors.every((s) => s.step === 0)).toBe(true);
  });

  it('1970 年の写真があっても最も内側の輪は 2017 年で止まる', () => {
    const rings = toYearRings(
      [{ month: '1970-01', count: 1 }, ...months],
      '2025-04',
      null,
    );
    expect(rings.at(0)?.year).toBe('2017');
    expect(rings).toHaveLength(9);
    expect(rings[0].sectors[0].count).toBe(1);
  });
});

describe('centerYearOf', () => {
  const rings = toYearRings(
    [
      { month: '2023-11', count: 50 },
      { month: '2024-03', count: 200 },
    ],
    '2025-04',
    null,
  );

  it('処理中の撮影月があればその年', () => {
    expect(centerYearOf(rings, '2023-11')).toBe('2023');
  });

  it('処理中の月が無ければ写真がある最も新しい年', () => {
    expect(centerYearOf(rings, null)).toBe('2024');
  });

  it('写真が無ければ今年', () => {
    expect(centerYearOf(toYearRings([], '2025-04', null), null)).toBe('2025');
  });
});

describe('ringGeometry', () => {
  it('内側から外側へ半径が増え、輪どうしが重ならない', () => {
    const rings = ringGeometry(10);
    expect(rings).toHaveLength(10);
    for (const [i, ring] of rings.entries()) {
      expect(ring.outerRadius).toBeGreaterThan(ring.innerRadius);
      const next = rings[i + 1];
      if (next !== undefined) {
        expect(next.innerRadius).toBeGreaterThan(ring.outerRadius);
      }
    }
  });

  it('輪の数によらず最も外側の外径はほぼ同じ（差は輪の隙間の半分まで）', () => {
    const outer = (n: number) => ringGeometry(n).at(-1)?.outerRadius ?? 0;
    expect(Math.abs(outer(1) - outer(10))).toBeLessThan(1.25);
  });

  it('輪が細いときは最も外側から 1 周おきに年ラベルを出す', () => {
    expect(ringGeometry(3).every((r) => r.labelled)).toBe(true);
    expect(ringGeometry(10).map((r) => r.labelled)).toEqual([
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
    ]);
  });

  it('輪が無ければ空', () => {
    expect(ringGeometry(0)).toEqual([]);
  });
});

describe('sectorPath', () => {
  const ring = { innerRadius: 100, outerRadius: 120 };

  it('1 月は 12 時のすぐ右から始まり、外側の弧・内側の弧で閉じたパスになる', () => {
    const d = sectorPath(ring, 0);
    expect(d).toMatch(
      /^M [\d.]+ [\d.]+ A 120 120 0 0 1 .* A 100 100 0 0 0 .* Z$/u,
    );
    // 12 時の右側（x が中心より大きく、y が中心より上）
    const [x, y] = d.slice(2).split(' ').map(Number);
    expect(x).toBeGreaterThan(200);
    expect(y).toBeLessThan(200);
  });

  it('outset を渡すと区画の外側を回る輪郭になる', () => {
    expect(sectorPath(ring, 3, 2)).toContain('A 122 122');
    expect(sectorPath(ring, 3, 2)).toContain('A 98 98');
  });
});

describe('yearMonthOf', () => {
  it('ローカルタイムの年月をゼロ埋めで返す', () => {
    expect(yearMonthOf(new Date(2025, 0, 31, 23, 59))).toBe('2025-01');
  });
});
