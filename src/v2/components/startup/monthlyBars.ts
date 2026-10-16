/**
 * 起動画面の月別棒グラフを組み立てる純粋関数群。
 *
 * メインプロセスは写真が 1 枚以上ある月だけを `InitStats.months` で送る（月の昇順）。
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
 * 横軸の左端にできる最も古い月。VRChat の一般公開（Steam の早期アクセス）が 2017 年 2 月なので、
 * それより前の撮影月を持つ写真は、ファイル名の日時が誤っているか、端末の時計が初期値（1970 年など）の
 * まま撮られたものとみなす。
 */
const CHART_FLOOR_MONTH: YearMonth = '2017-01';

/**
 * 撮影月を、横軸に並べる範囲（CHART_FLOOR_MONTH から今月まで）の中の月に寄せる。
 * 範囲より後の月は今月に、前の月は左端の月に寄せる。
 * グラフの枚数と処理中の月の強調が同じ棒を指すよう、両方ともこの関数を通す。
 * `YYYY-MM` はゼロ埋めされているので、文字列の大小比較が年月の前後と一致する。
 */
export const chartMonthOf = (
  month: YearMonth,
  currentMonth: YearMonth,
): YearMonth => {
  if (month > currentMonth) {
    return currentMonth;
  }
  const floor =
    CHART_FLOOR_MONTH < currentMonth ? CHART_FLOOR_MONTH : currentMonth;
  return month < floor ? floor : month;
};

/**
 * 最初に写真がある月から今月までを、写真の無い月も 0 枚として埋めて返す。
 * 横軸の右端は常に今月、左端は早くても CHART_FLOOR_MONTH にし、範囲外の月の枚数は端の棒に足す
 * （chartMonthOf）。範囲を最も新しい・古い写真の月まで伸ばすと、2099 年や 1970 年のような日時の写真が
 * 1 枚あるだけで数百本の空の棒が並んでしまうため。端の棒に足すのは、写真を捨てずに
 * グラフの枚数の合計を累計の写真枚数と一致させるため。
 */
export const fillMonthRange = (
  months: readonly MonthCount[],
  currentMonth: YearMonth,
): MonthCount[] => {
  const first = months.at(0);
  if (first === undefined) {
    return [];
  }
  const counts = new Map<YearMonth, number>();
  for (const { month, count } of months) {
    const key = chartMonthOf(month, currentMonth);
    counts.set(key, (counts.get(key) ?? 0) + count);
  }
  const start = chartMonthOf(first.month, currentMonth);
  const filled: MonthCount[] = [];
  for (let month = start; month <= currentMonth; month = nextYearMonth(month)) {
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
