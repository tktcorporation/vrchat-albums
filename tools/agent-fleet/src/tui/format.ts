import { match } from 'ts-pattern';
import type { RowStatus } from '../model/row';

const AGE_UNITS: [number, string][] = [[86_400_000, 'd'], [3_600_000, 'h'], [60_000, 'm'], [1000, 's']];

export function formatAge(from: number | null, now: number): string {
  if (from === null) return '-';
  const diff = Math.max(0, now - from);
  for (const [ms, unit] of AGE_UNITS) if (diff >= ms) return `${Math.floor(diff / ms)}${unit}`;
  return '0s';
}

// 端末では全角が 2 列を使うので、幅は文字数ではなく表示列で数える
const cellWidth = (ch: string): number => (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1);

export function textWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += cellWidth(ch);
  return w;
}

export function truncate(text: string | null, width: number): string {
  if (!text) return '';
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (textWidth(oneLine) <= width) return oneLine;
  return truncateForce(oneLine, width);
}

// truncate は「元の文字列が width を超えるときだけ」…を付けるが、複数行に折り返した
// 続きが別行にある場合は、その行自体が width に収まっていても省略があることを示したい。
// そのためのバリアントとして、無条件に…を付けて切る版を分けて公開する。
export function truncateForce(text: string, width: number): string {
  let out = '';
  let w = 0;
  for (const ch of text) {
    const cw = cellWidth(ch);
    if (w + cw > width - 1) break;
    out += ch;
    w += cw;
  }
  return out + '…';
}

// 全角混じりの文字列は文字数と表示幅がずれるため、padEnd（UTF-16 単位）でパディングすると
// 隣り合う行の列がずれる。表示幅ベースで右側に半角スペースを足す。
export function padDisplay(text: string, width: number): string {
  const w = textWidth(text);
  return w >= width ? text : text + ' '.repeat(width - w);
}

// 空白を含まない1単語が width を超える場合（長い URL 等）、そのまま1行に
// 詰めると Ink 側が改めて折り返してしまい maxLines の見積りが崩れる。
// 表示幅ぶんずつ強制的に分割し、最後の断片だけ後続の単語と結合できるよう残す。
function splitByWidth(word: string, width: number): string[] {
  const chunks: string[] = [];
  let current = '';
  let w = 0;
  for (const ch of word) {
    const cw = textWidth(ch);
    if (w + cw > width && current) {
      chunks.push(current);
      current = ch;
      w = cw;
    } else {
      current += ch;
      w += cw;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// 折り返しは幅いっぱいまで単語を詰め、maxLines を超えたら最後の行を省略記号で切る。
export function wrapLines(text: string, width: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (textWidth(word) > width) {
      if (current) {
        lines.push(current);
        current = '';
      }
      const chunks = splitByWidth(word, width);
      for (let i = 0; i < chunks.length - 1; i++) lines.push(chunks[i] as string);
      current = chunks[chunks.length - 1] ?? '';
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (current && textWidth(candidate) > width) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  const visible = lines.slice(0, maxLines);
  visible[maxLines - 1] = truncateForce(visible[maxLines - 1] ?? '', width);
  return visible;
}

export const statusGlyph = (status: RowStatus): string =>
  match(status)
    .with('blocked', () => '⏸')
    .with('working', () => '◐')
    .with('idle', () => '·')
    .with('done', () => '✔')
    .with('failed', () => '✖')
    .with('stopped', () => '■')
    .exhaustive();

export const statusColor = (status: RowStatus): string =>
  match(status)
    .with('blocked', () => 'yellow')
    .with('working', () => 'cyan')
    .with('idle', () => 'gray')
    .with('done', () => 'green')
    .with('failed', () => 'red')
    .with('stopped', () => 'gray')
    .exhaustive();

// 一覧の幅を圧迫しないよう、モデル名は系列名（fable/opus/sonnet/haiku）か
// gpt 系の版番号までに丸める。raw の値はバージョン修飾（[1m] 等）を含むため先に落とす。
export function shortModel(raw: string | null): string {
  if (raw === null) return '-';
  const stripped = raw.replace(/\[[^\]]*\]$/, '');
  if (stripped.includes('fable')) return 'fable';
  if (stripped.includes('opus')) return 'opus';
  if (stripped.includes('sonnet')) return 'sonnet';
  if (stripped.includes('haiku')) return 'haiku';
  if (stripped.startsWith('gpt-')) return stripped.split('-').slice(0, 2).join('-');
  return stripped;
}
