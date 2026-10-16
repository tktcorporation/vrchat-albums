/**
 * 起動画面の月別棒グラフを組み立てる純粋関数群。
 *
 * メインプロセスは写真が 1 枚以上ある月だけを `InitStats.months` で送る。
 * 画面では撮影期間の空白も見せたいので、最初の月から今月までを 1 か月ずつ埋めて並べる。
 */
import type { InitStats } from '../../hooks/useInitProgress';

/** `YYYY-MM` 形式の年月 */
type YearMonth = string;

type MonthCount = InitStats['months'][number];

/** 1 本の棒の塗り分け。処理中の月・写真が数えられた月・写真が無い月を区別する */
export type BarTone = 'current' | 'counted' | 'empty';

export interface MonthBar {
  month: YearMonth;
  count: number;
  /** 棒の高さ（最大枚数の月を 1 とした比。写真が無い月は 0） */
  ratio: number;
  tone: BarTone;
}

/** 横軸の年ラベル。`start` は棒の並びでの開始位置（0 始まり）、`span` はその年に含まれる月数 */
export interface YearSpan {
  year: string;
  start: number;
  span: number;
}

const parseYearMonth = (month: YearMonth): { year: number; month: number } => ({
  year: Number(month.slice(0, 4)),
  month: Number(month.slice(5, 7)),
});

const formatYearMonth = (year: number, month: number): YearMonth =>
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;

const nextYearMonth = (month: YearMonth): YearMonth => {
  const parsed = parseYearMonth(month);
  return parsed.month === 12
    ? formatYearMonth(parsed.year + 1, 1)
    : formatYearMonth(parsed.year, parsed.month + 1);
};

/**
 * ローカルタイムでの年月。写真の撮影月もローカルタイム基準で数えているため、今月もそれに揃える。
 */
export const yearMonthOf = (date: Date): YearMonth =>
  formatYearMonth(date.getFullYear(), date.getMonth() + 1);

/**
 * 最初に写真がある月から今月までを、写真の無い月も 0 枚として埋めて返す。
 * 端末の時計がずれて写真の月が今月より後にある場合は、その最後の月までを並べる。
 * `YYYY-MM` はゼロ埋めされているので、文字列の大小比較が年月の前後と一致する。
 */
export const fillMonthRange = (
  months: readonly MonthCount[],
  currentMonth: YearMonth,
): MonthCount[] => {
  const first = months.at(0);
  const last = months.at(-1);
  if (first === undefined || last === undefined) {
    return [];
  }
  const end = last.month > currentMonth ? last.month : currentMonth;
  const counts = new Map(months.map((m) => [m.month, m.count]));
  const filled: MonthCount[] = [];
  for (let month = first.month; month <= end; month = nextYearMonth(month)) {
    filled.push({ month, count: counts.get(month) ?? 0 });
  }
  return filled;
};

/**
 * 月の並びを年ごとにまとめ、横軸の年ラベルが何本分の棒にまたがるかを返す。
 */
export const yearSpans = (months: readonly YearMonth[]): YearSpan[] =>
  months.reduce<YearSpan[]>((spans, month, index) => {
    const year = month.slice(0, 4);
    const last = spans.at(-1);
    if (last !== undefined && last.year === year) {
      return [...spans.slice(0, -1), { ...last, span: last.span + 1 }];
    }
    return [...spans, { year, start: index, span: 1 }];
  }, []);

const toneOf = (isHighlighted: boolean, count: number): BarTone => {
  if (isHighlighted) {
    return 'current';
  }
  return count > 0 ? 'counted' : 'empty';
};

/**
 * 埋めた月の並びを棒に変換する。高さは最大枚数の月を基準にした比で、
 * `highlightMonth`（写真インデックス中に処理している撮影月）は処理中として塗り分ける。
 */
export const toMonthBars = (
  months: readonly MonthCount[],
  highlightMonth: YearMonth | null,
): MonthBar[] => {
  const max = months.reduce((m, { count }) => Math.max(m, count), 0);
  return months.map(({ month, count }) => {
    return {
      month,
      count,
      ratio: max > 0 ? count / max : 0,
      tone: toneOf(month === highlightMonth, count),
    };
  });
};
