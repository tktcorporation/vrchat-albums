/**
 * doc 先頭の frontmatter から lifecycle 宣言を読み取る。
 *
 * YAML パーサに委ねる理由: 読み取るキーは 3 つだけだが、値の解釈には YAML の
 * 構文規則（クオート・インラインコメント・null スカラー・入れ子）がまるごと要る。
 * 行ベースで近似すると規則の抜けが「宣言したつもりの猶予が効かない」「正当な
 * 宣言が拒否される」という形で出続けるため、構文の解釈はパーサに任せ、ここは
 * 「読み取った値が lint の契約を満たすか」の検証だけを持つ。
 */

import { parse as parseYaml } from 'yaml';
import { DateTime } from 'luxon';
import { type Lifecycle, lifecycleSchema } from './config.ts';

export interface DocMeta {
  /** パス由来の既定 lifecycle を上書きする宣言 */
  lifecycle: Lifecycle | null;
  /** この日まで鮮度チェックを猶予する（YYYY-MM-DD） */
  reviewBy: string | null;
  /** 猶予する理由。reviewBy と対で必須 */
  reviewReason: string | null;
}

export type FrontmatterParseResult =
  | { kind: 'ok'; meta: DocMeta }
  | { kind: 'invalid'; problems: string[] };

const EMPTY_META: DocMeta = { lifecycle: null, reviewBy: null, reviewReason: null };

/**
 * frontmatter の区切り行。インデントを許さないのは、ブロックスカラー
 * （`review-reason: |` の続き）に現れる `  ---` を閉じ区切りと取り違えると、
 * YAML が途中で切れて宣言が消え、残りが本文として Markdown パーサへ流れるため。
 */
const DELIMITER_PATTERN = /^---\s*$/;

function hasOpeningDelimiter(lines: readonly string[]): boolean {
  const first = lines[0];
  return first !== undefined && DELIMITER_PATTERN.test(first);
}

/**
 * frontmatter ブロックの行範囲を求める。frontmatter を持たない doc は null。
 * `closingIndex` は閉じの `---` の行インデックス（0-indexed）。
 */
function findBlockRange(lines: readonly string[]): { closingIndex: number } | null {
  if (!hasOpeningDelimiter(lines)) return null;

  const closingIndex = lines.findIndex((line, index) => index > 0 && DELIMITER_PATTERN.test(line));
  return closingIndex === -1 ? null : { closingIndex };
}

/** frontmatter ブロックの中身を切り出す。frontmatter を持たない doc は null（違反ではない） */
function extractBlock(content: string): { yaml: string } | { problem: string } | null {
  const lines = content.split('\n');
  if (!hasOpeningDelimiter(lines)) return null;

  const range = findBlockRange(lines);
  if (range === null) {
    return { problem: 'frontmatter が `---` で閉じられていません' };
  }
  return { yaml: lines.slice(1, range.closingIndex).join('\n') };
}

/**
 * frontmatter を空行に置き換える。
 *
 * 本文として解釈すべきでないメタデータ（Markdown 風の文字列を含む説明文など）を
 * 後段の Markdown パーサに渡さないため。行を削らず空行にするのは、報告する
 * 行番号を実ファイルとずらさないため。
 */
export function stripFrontmatter(content: string): string {
  const lines = content.split('\n');
  const range = findBlockRange(lines);
  if (range === null) return content;

  return lines.map((line, index) => (index <= range.closingIndex ? '' : line)).join('\n');
}

/**
 * lint が読む 3 キーは、いずれも 1 行のテキストとして書かれている必要がある。
 * null・数値・真偽値・入れ子などが来たら、宣言として成立していないものとして扱う。
 */
function readTextField(
  document: Record<string, unknown>,
  key: string,
  problems: string[],
): string | null {
  if (!(key in document)) return null;

  const value = document[key];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
    problems.push(`\`${key}\` の値が空です`);
    return null;
  }

  if (value === null) {
    problems.push(`\`${key}\` に値がありません（null は未記入と同じ扱いです）`);
    return null;
  }

  problems.push(`\`${key}\` は 1 行のテキストで書いてください`);
  return null;
}

export function parseDocMeta(content: string): FrontmatterParseResult {
  const block = extractBlock(content);
  if (block === null) return { kind: 'ok', meta: EMPTY_META };
  if ('problem' in block) return { kind: 'invalid', problems: [block.problem] };

  let document: unknown;
  try {
    document = parseYaml(block.yaml);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { kind: 'invalid', problems: [`frontmatter の YAML を解釈できません: ${detail}`] };
  }

  // 空の frontmatter（`---` だけ）や、マッピング以外を書いた doc に宣言は無い
  if (document === null || document === undefined) return { kind: 'ok', meta: EMPTY_META };
  if (typeof document !== 'object' || Array.isArray(document)) {
    return { kind: 'invalid', problems: ['frontmatter はキーと値の対で書いてください'] };
  }

  const problems: string[] = [];
  const fields: Record<string, unknown> = { ...document };

  const rawLifecycle = readTextField(fields, 'lifecycle', problems);
  let lifecycle: Lifecycle | null = null;
  if (rawLifecycle !== null) {
    const parsed = lifecycleSchema.safeParse(rawLifecycle);
    if (parsed.success) {
      lifecycle = parsed.data;
    } else {
      problems.push(
        `\`lifecycle: ${rawLifecycle}\` は不正です（${lifecycleSchema.options.join(' | ')} のいずれか）`,
      );
    }
  }

  const reviewBy = readReviewBy(fields, problems);
  const reviewReason = readTextField(fields, 'review-reason', problems);

  if (reviewBy !== null && reviewReason === null) {
    problems.push('`review-by` を書くなら `review-reason` に猶予する理由も書いてください');
  }
  if (reviewBy === null && reviewReason !== null) {
    problems.push('`review-reason` だけでは猶予されません。`review-by` に期限日を書いてください');
  }

  if (problems.length > 0) return { kind: 'invalid', problems };
  return { kind: 'ok', meta: { lifecycle, reviewBy, reviewReason } };
}

/**
 * 猶予期限を読む。
 *
 * 形式は YYYY-MM-DD に限る — `2027` のような短縮形を通すと、打ち間違いが
 * 「1 月 1 日まで猶予」として黙って成立し、猶予が意図せず伸びる。
 * YAML 1.2 の core schema には日付型が無く、この値は常に文字列として届く。
 */
function readReviewBy(document: Record<string, unknown>, problems: string[]): string | null {
  if (!('review-by' in document)) return null;

  const value = document['review-by'];
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    problems.push('`review-by` は YYYY-MM-DD 形式の実在する日付で書いてください');
    return null;
  }
  if (!DateTime.fromISO(value, { zone: 'utc' }).isValid) {
    problems.push(`\`review-by: ${value}\` は実在する日付ではありません`);
    return null;
  }
  return value;
}
