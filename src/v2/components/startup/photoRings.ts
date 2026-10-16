/**
 * 起動画面の「年輪」（1 年を 1 周の輪、1 か月を輪の 1 区画にした図）を組み立てる純粋関数群。
 *
 * メインプロセスは写真が 1 枚以上ある月だけを `InitStats.months` で送る（月の昇順）。
 * 図では撮影期間の空白も見せたいので、最初の月の年から今年までの輪を 12 区画ずつ並べる。
 */
import type { InitStats } from '../../hooks/useInitProgress';

/** `YYYY-MM` 形式の年月 */
type YearMonth = string;

type MonthCount = InitStats['months'][number];

/**
 * 1 区画の塗り分け。処理中の月・写真が数えられた月・写真が無い月・今月より後の月を区別する
 */
export type SectorTone = 'current' | 'counted' | 'empty' | 'future';

export interface RingSector {
  month: YearMonth;
  count: number;
  /** 塗りの濃さの段階（0 = 写真なし、FILL_STEPS = 最も写真が多い月と同じ段階） */
  step: number;
  tone: SectorTone;
}

/** 1 年分の輪。`sectors` は 1 月から 12 月の順に 12 区画 */
export interface YearRing {
  year: string;
  sectors: RingSector[];
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
 * 図に並べる最も古い月。VRChat の一般公開（Steam の早期アクセス）が 2017 年 2 月なので、
 * それより前の撮影月を持つ写真は、ファイル名の日時が誤っているか、端末の時計が初期値（1970 年など）の
 * まま撮られたものとみなす。
 */
const CHART_FLOOR_MONTH: YearMonth = '2017-01';

/**
 * 撮影月を、図に並べる範囲（CHART_FLOOR_MONTH から今月まで）の中の月に寄せる。
 * 範囲より後の月は今月に、前の月は最も古い月に寄せる。
 * 区画の枚数と処理中の月の強調が同じ区画を指すよう、両方ともこの関数を通す。
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
 * 範囲の終わりは常に今月、始まりは早くても CHART_FLOOR_MONTH にし、範囲外の月の枚数は端の月に足す
 * （chartMonthOf）。範囲を最も新しい・古い写真の月まで伸ばすと、2099 年や 1970 年のような日時の写真が
 * 1 枚あるだけで数十周の空の輪が並んでしまうため。端の月に足すのは、写真を捨てずに
 * 図の枚数の合計を累計の写真枚数と一致させるため。
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

/** 塗りの濃さの段階数。色相を変えず濃さだけで枚数の多さを見せる */
export const FILL_STEPS = 5;

/**
 * 枚数を塗りの段階にする。写真が 1 枚でもあれば最も薄い段階 1 にし、写真の無い月（0）と見分けられるようにする。
 */
export const fillStepOf = (count: number, max: number): number => {
  if (count <= 0 || max <= 0) {
    return 0;
  }
  return Math.min(FILL_STEPS, Math.ceil((count / max) * FILL_STEPS));
};

const toneOf = (
  month: YearMonth,
  count: number,
  currentMonth: YearMonth,
  highlightMonth: YearMonth | null,
): SectorTone => {
  if (month === highlightMonth) {
    return 'current';
  }
  if (month > currentMonth) {
    return 'future';
  }
  return count > 0 ? 'counted' : 'empty';
};

/**
 * 月ごとの枚数を、最初の写真の年から今年までの輪に並べる（配列の先頭が最も古い年 = 最も内側の輪）。
 * 写真が 1 枚も無ければ今年の輪を 1 周だけ返す。
 * `highlightMonth` は chartMonthOf で範囲内に寄せた、写真インデックス中に処理している撮影月。
 */
export const toYearRings = (
  months: readonly MonthCount[],
  currentMonth: YearMonth,
  highlightMonth: YearMonth | null,
): YearRing[] => {
  const filled = fillMonthRange(months, currentMonth);
  const counts = new Map(filled.map(({ month, count }) => [month, count]));
  const max = filled.reduce((m, { count }) => Math.max(m, count), 0);
  const lastYear = parseYearMonth(currentMonth).year;
  const first = filled.at(0);
  const firstYear =
    first === undefined ? lastYear : parseYearMonth(first.month).year;

  const rings: YearRing[] = [];
  for (let year = firstYear; year <= lastYear; year++) {
    const sectors = Array.from({ length: 12 }, (_, i): RingSector => {
      const month = formatYearMonth(year, i + 1);
      const count = counts.get(month) ?? 0;
      return {
        month,
        count,
        step: fillStepOf(count, max),
        tone: toneOf(month, count, currentMonth, highlightMonth),
      };
    });
    rings.push({ year: String(year), sectors });
  }
  return rings;
};

/**
 * 図の中央に大きく出す年。処理中の撮影月があればその年、無ければ写真がある最も新しい年、
 * 写真が 1 枚も無ければ最も外側（今年）の輪の年。
 */
export const centerYearOf = (
  rings: readonly YearRing[],
  highlightMonth: YearMonth | null,
): string => {
  if (highlightMonth !== null) {
    return highlightMonth.slice(0, 4);
  }
  const latest = rings.findLast((ring) =>
    ring.sectors.some((sector) => sector.count > 0),
  );
  return (latest ?? rings.at(-1))?.year ?? '';
};

// ---------------------------------------------------------------------------
// 図形（SVG の viewBox 上の座標。中心は (RING_CENTER, RING_CENTER)）
// ---------------------------------------------------------------------------

/** viewBox の一辺 */
export const RING_VIEWBOX = 400;
export const RING_CENTER = RING_VIEWBOX / 2;
/** 最も外側の輪の外径。処理中の区画の縁取りが viewBox からはみ出ない余白を残す */
const OUTER_RADIUS = 194;
/** 中央の年が収まる穴の最小半径 */
const MIN_HOLE_RADIUS = 86;
/** 輪 1 周分の太さ（隙間込み）の上限。年が少ないときに輪が太りすぎないようにする */
const MAX_RING_PITCH = 30;
/** 隣り合う輪の隙間の上限。輪が細いときは太さとの比（RING_GAP_RATIO）で詰め、隙間が縞模様にならないようにする */
const MAX_RING_GAP = 2.5;
const RING_GAP_RATIO = 0.16;
/** 隣り合う区画の隙間（弧の長さ） */
const SECTOR_GAP = 2;
/**
 * 12 時の位置に通す、年ラベル用の縦の通り道の幅。
 * 角度ではなく幅で決めるので、内側の輪でも外側の輪でも同じ幅の通り道になる
 */
const LABEL_SLOT_WIDTH = 32;
/** これより輪が細いと年ラベルの文字が隣の輪のラベルと重なるため、1 周おきにラベルを出す */
const MIN_PITCH_FOR_EVERY_LABEL = 15;

export interface RingGeometry {
  innerRadius: number;
  outerRadius: number;
  /** 12 時の通り道に年ラベルを出すか */
  labelled: boolean;
  /** 年ラベルを置く y 座標（輪の太さの中央） */
  labelY: number;
}

/**
 * 輪の数から各輪の内径・外径を決める（配列の先頭が最も内側）。
 * 最も外側の輪の外径は常に OUTER_RADIUS に揃え、輪が少ないときは中央の穴を広げる。
 */
export const ringGeometry = (ringCount: number): RingGeometry[] => {
  if (ringCount <= 0) {
    return [];
  }
  const pitch = Math.min(
    MAX_RING_PITCH,
    (OUTER_RADIUS - MIN_HOLE_RADIUS) / ringCount,
  );
  const hole = OUTER_RADIUS - pitch * ringCount;
  const ringGap = Math.min(MAX_RING_GAP, pitch * RING_GAP_RATIO);
  const everyLabel = pitch >= MIN_PITCH_FOR_EVERY_LABEL;
  return Array.from({ length: ringCount }, (_, i) => {
    const innerRadius = hole + pitch * i + ringGap / 2;
    const outerRadius = hole + pitch * (i + 1) - ringGap / 2;
    // 1 周おきのときも最も外側（今年）の輪には必ずラベルを出す
    const fromOutside = ringCount - 1 - i;
    return {
      innerRadius,
      outerRadius,
      labelled: everyLabel || fromOutside % 2 === 0,
      labelY: RING_CENTER - (innerRadius + outerRadius) / 2,
    };
  });
};

/** 半径 r で弧の長さ length に当たる角度（ラジアン） */
const angleOfLength = (length: number, r: number): number =>
  2 * Math.asin(Math.min(1, length / 2 / r));

/** 12 時を 0、時計回りを正とした角度の点 */
const pointAt = (r: number, angle: number): string => {
  const x = RING_CENTER + r * Math.sin(angle);
  const y = RING_CENTER - r * Math.cos(angle);
  return `${x.toFixed(2)} ${y.toFixed(2)}`;
};

/**
 * `monthIndex`（0 = 1 月）の区画の SVG パス。1 月を 12 時のすぐ右に置き、時計回りに並べる。
 * 12 時の位置は年ラベルの通り道として空け、残りの角度を 12 等分する。
 * `outset` を渡すと区画を四方へその分だけ広げた輪郭を返す（処理中の区画を縁取る線に使う）。
 */
export const sectorPath = (
  ring: Pick<RingGeometry, 'innerRadius' | 'outerRadius'>,
  monthIndex: number,
  outset = 0,
): string => {
  const mid = (ring.innerRadius + ring.outerRadius) / 2;
  const ri = ring.innerRadius - outset;
  const ro = ring.outerRadius + outset;
  const slot = angleOfLength(LABEL_SLOT_WIDTH, mid) / 2;
  const span = (2 * Math.PI - slot * 2) / 12;
  const gap =
    (angleOfLength(SECTOR_GAP, mid) - angleOfLength(outset * 2, mid)) / 2;
  const a0 = slot + span * monthIndex + gap;
  const a1 = slot + span * (monthIndex + 1) - gap;
  return [
    `M ${pointAt(ro, a0)}`,
    `A ${ro} ${ro} 0 0 1 ${pointAt(ro, a1)}`,
    `L ${pointAt(ri, a1)}`,
    `A ${ri} ${ri} 0 0 0 ${pointAt(ri, a0)}`,
    'Z',
  ].join(' ');
};
