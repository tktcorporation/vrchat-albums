/**
 * Bash コマンドの所要時間をコマンド種別ごとに蓄積するための共通部品。
 * pre-bash-timing.ts（実行前の見込み提示）と post-bash-timing.ts（実行後の記録）が使う。
 *
 * 実績は sessionStateDir()（worktree を跨いで同じ場所）の timings.json に置く。
 */
import { mkdir, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { sessionStateDir } from './hook-utils.ts';

/** これ未満は記録も報告もしない。短いコマンドの実績は判断に使わない。 */
export const RECORD_MIN_SEC = 10;
/** これ以上かかったら所要時間を報告に含めるよう促す。 */
export const REPORT_MIN_SEC = 30;
/** これ以上かかるコマンドは背景実行を勧める。 */
export const BACKGROUND_MIN_SEC = 60;
/** コマンド種別ごとに保持する実績の件数。 */
const KEEP_SAMPLES = 20;

/**
 * コマンド文字列を「種別」に丸める。引数の差（テストファイル名、PR 番号、フラグ）を無視して
 * 同じ種類の実行を同じ鍵にまとめるため、コマンド名とサブコマンドらしい語だけを先頭 3 語まで残す。
 * `cd X &&` や `timeout N` のような前置きは種別ではないので剥がす。
 */
export function commandKey(raw: string): string {
  let text = raw.trim();
  // 先頭の作業ディレクトリ移動と環境変数代入を剥がす
  text = text.replace(/^(?:cd\s+\S+\s*(?:&&|;)\s*)+/, '');
  text = text.replace(/^(?:[A-Z_][A-Z0-9_]*=\S*\s+)+/, '');
  text = text.replace(/^(?:timeout\s+\S+\s+|time\s+|nice\s+(?:-n\s*\d+\s+)?|env\s+)+/, '');
  // 最初のパイプ・連結・リダイレクトまでを 1 コマンドとみなす
  const first = text.split(/\s*(?:\|\||&&|\||;|>|<)\s*/)[0] ?? '';
  const words = first.split(/\s+/).filter(Boolean);
  const name = words[0]?.split('/').at(-1) ?? '';
  // ランタイム経由の実行はスクリプト名が種別になる（`bun scripts/foo.ts` → `bun foo.ts`）
  const script = /^(?:bun|node|tsx|deno|python3?|ruby|perl)$/.test(name)
    ? words.slice(1).find((word) => !word.startsWith('-') && /\.[a-z]+$/i.test(word))
    : undefined;
  // サブコマンドらしい語: フラグでも、パスでも、拡張子付きでも、数値でもない
  const subcommands = words.slice(1).filter((word) => /^[a-z][a-z0-9:_-]*$/i.test(word));
  return [name, script?.split('/').at(-1), ...subcommands].filter(Boolean).slice(0, 3).join(' ');
}

export type TimingStore = Record<string, number[]>;

export async function readTimings(): Promise<{ path: string; store: TimingStore } | null> {
  const directory = await sessionStateDir();
  if (!directory) return null;
  const path = join(directory, 'timings.json');
  const file = Bun.file(path);
  if (!(await file.exists())) return { path, store: {} };
  const parsed: unknown = await file.json().catch(() => null);
  const store: TimingStore = {};
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
    for (const [key, values] of Object.entries(parsed))
      if (Array.isArray(values) && values.every((value) => typeof value === 'number'))
        store[key] = values;
  return { path, store };
}

/**
 * 実績を 1 件追加して保存する。並列の Bash 呼び出しが同時に書いても壊れた JSON が残らないよう
 * 一時ファイル経由で置き換える（同時書き込みで片方の 1 件が落ちることは許容する）。
 */
export async function appendTiming(key: string, seconds: number): Promise<number[]> {
  const timings = await readTimings();
  if (!timings) return [];
  const history = timings.store[key] ?? [];
  timings.store[key] = [...history, seconds].slice(-KEEP_SAMPLES);
  await mkdir(dirname(timings.path), { recursive: true });
  const temp = `${timings.path}.${process.pid}.tmp`;
  await Bun.write(temp, `${JSON.stringify(timings.store)}\n`);
  await rename(temp, timings.path).catch(() => undefined);
  return history;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2)
    : (sorted[middle] ?? 0);
}
