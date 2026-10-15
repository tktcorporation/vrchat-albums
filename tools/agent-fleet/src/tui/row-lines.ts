import type { FleetRow } from '../model/row';
import { formatAge, padDisplay, shortModel, statusGlyph, textWidth, truncate, truncateForce } from './format';

// 1セッションを2行で描く。TUI（色付き）と --once（プレーン連結）の両方がこの関数群を
// 通ることで、幅の計算がずれて片方だけ列がそろわなくなる事態を防ぐ。ここでは色を
// 一切持たず、幅が確定した文字列の断片（segment）だけを返す。

export const MARGIN = 1; // 端末の最終列には書かない
export const LEFT_WIDTH = 5; // カーソル(3) + 状態記号(1) + 空白(1)
export const GAP_WIDTH = 2; // name/location ブロックと右ブロックの間
const AGENT_WIDTH = 6;
const KIND_WIDTH = 3; // 'bg ' / 'int'
const MODEL_WIDTH = 7;
const AGE_WIDTH = 4;
const META_WIDTH = AGENT_WIDTH + 1 + KIND_WIDTH + 1 + MODEL_WIDTH; // agent kind model
export const RIGHT_WIDTH = META_WIDTH + 2 + AGE_WIDTH; // meta + 区切り2 + age(4)

const NAME_MIN_WIDTH = 20;
const NAME_MAX_WIDTH = 40;
const NAME_MIN_WIDTH_NARROW = 10; // location を諦めたときの name の下限
const LOCATION_MIN_AVAIL = 32; // name 20 + 区切り 2 + location 10 が入る境目
export const LOCATION_SEP_WIDTH = 2;

export type Line1Layout = { nameWidth: number; locationWidth: number };

// name と location の配分は端末幅だけで決まる（選択や内容の長さに依存させない）。
// そうしないと行ごとに列がずれる。
export function computeLine1Layout(width: number): Line1Layout {
  const avail = width - MARGIN - LEFT_WIDTH - GAP_WIDTH - RIGHT_WIDTH;
  if (avail >= LOCATION_MIN_AVAIL) {
    const nameWidth = Math.min(NAME_MAX_WIDTH, Math.max(NAME_MIN_WIDTH, Math.floor(avail * 0.55)));
    return { nameWidth, locationWidth: avail - LOCATION_SEP_WIDTH - nameWidth };
  }
  // 幅が足りない端末では location を諦めて name に全部渡す。
  return { nameWidth: Math.max(NAME_MIN_WIDTH_NARROW, avail), locationWidth: 0 };
}

export type Line1Parts = {
  cursor: string;
  glyph: string;
  name: string;
  location: string; // locationWidth === 0 のときは ''（区切りごと出さない）
  meta: string;
  age: string;
  plain: string; // 色を除いた行1全体。selected 行はこれをそのまま padDisplay して inverse を掛ける
};

export function buildLine1(row: FleetRow, width: number, now: number, selected: boolean): Line1Parts {
  const { nameWidth, locationWidth } = computeLine1Layout(width);
  const cursor = selected ? ' ▶ ' : '   ';
  const glyph = statusGlyph(row.status);
  const name = padDisplay(truncate(row.name, nameWidth), nameWidth);
  const location = locationWidth > 0 ? padDisplay(truncate(row.location.display, locationWidth), locationWidth) : '';
  const sep = locationWidth > 0 ? ' '.repeat(LOCATION_SEP_WIDTH) : '';
  const meta = `${row.agent.padEnd(AGENT_WIDTH)} ${row.kind === 'background' ? 'bg ' : 'int'} ${padDisplay(shortModel(row.model), MODEL_WIDTH)}`;
  const age = formatAge(row.updatedAt, now).padStart(AGE_WIDTH);
  const rawPlain = `${cursor}${glyph} ${name}${sep}${location}${' '.repeat(GAP_WIDTH)}${meta}  ${age}`;
  // name を NAME_MIN_WIDTH_NARROW まで確保する下限と、右ブロックの固定幅が両方とも
  // 譲れないため、極端に狭い端末（avail が NAME_MIN_WIDTH_NARROW を割り込む幅）では
  // 各列の合計が width - MARGIN を超えうる。TUI 側は Box の width 制約と
  // wrap="truncate-end" で切れるが、--once の平文出力はこの関数の戻り値をそのまま
  // 連結するため、ここでも同じ幅に収める。
  const maxWidth = width - MARGIN;
  const plain = textWidth(rawPlain) > maxWidth ? truncateForce(rawPlain, maxWidth) : rawPlain;
  return { cursor, glyph, name, location, meta, age, plain };
}

export type Line2Parts = {
  indent: string; // name の開始位置にそろえる（LEFT_WIDTH と同じ幅）
  summaryPrefix: string; // '要判断: ' / '完了: ' / statusNote 付きの組み合わせ。空のこともある
  summary: string;
  plain: string;
};

// 行2は折り返さない（listHeight の見積りが「1セッション = 2行」前提のため、
// 折り返すと行数が崩れる）。表示幅を超えるぶんは summary 側から切る。
export function buildLine2(row: FleetRow, width: number): Line2Parts {
  const indent = ' '.repeat(LEFT_WIDTH);
  const summaryWidth = Math.max(0, width - MARGIN - LEFT_WIDTH);
  const rawSummary = row.pending?.text ?? row.activity ?? (row.status === 'idle' ? '(idle)' : '');
  const notePrefix = row.statusNote ? `[${row.statusNote}] ` : '';
  const summaryPrefixFull = notePrefix + (row.status === 'done' ? '完了: ' : row.status === 'blocked' ? '要判断: ' : '');
  const prefixFullWidth = textWidth(summaryPrefixFull);
  const summaryPrefix = prefixFullWidth <= summaryWidth ? summaryPrefixFull : truncateForce(summaryPrefixFull, summaryWidth);
  const bodyWidth = Math.max(0, summaryWidth - textWidth(summaryPrefix));
  const summary = bodyWidth > 0 ? truncate(rawSummary, bodyWidth) : '';
  // 行1と同じく、--once の平文出力がそのまま連結されるため、極端に狭い幅
  // （インデントだけで width を超える幅）でも戻り値の幅を width - MARGIN に収める。
  const rawPlain = `${indent}${summaryPrefix}${summary}`;
  const maxWidth = Math.max(0, width - MARGIN);
  const plain = textWidth(rawPlain) > maxWidth ? truncateForce(rawPlain, maxWidth) : rawPlain;
  return { indent, summaryPrefix, summary, plain };
}
