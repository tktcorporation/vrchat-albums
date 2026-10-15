import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { str, time } from './claude-jobs';
import { classifyIoError, fileSize, parseJsonl, readHead, readTail } from './fs';
import { fail, ok, type SourceResult } from './types';

export type TranscriptSummary = {
  originalPrompt: string | null;
  latestPrompt: string | null;
  lastAssistantText: string | null;
  pendingQuestion: string | null;
  lastTimestamp: number | null;
  model: string | null;
};

export type TranscriptCache = Map<string, { size: number; summary: TranscriptSummary }>;

// transcript は数十 MB になるので、先頭と末尾だけを読む。
const HEAD_BYTES = 256 * 1024;
const TAIL_BYTES = 256 * 1024;

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec | null => (typeof v === 'object' && v !== null ? (v as Rec) : null);

// Claude Code は cwd の "/" と "." を "-" に置き換えたディレクトリ名で transcript を置く
export function projectDirName(cwd: string): string {
  return cwd.replace(/[/.]/g, '-');
}

export function findTranscriptPath(projectsDir: string, cwd: string, sessionId: string): string | null {
  const direct = join(projectsDir, projectDirName(cwd), `${sessionId}.jsonl`);
  if (existsSync(direct)) return direct;
  if (!existsSync(projectsDir)) return null;
  // worktree に入ると transcript の置き場所が変わるので、全ディレクトリから探す。
  // projectsDir が実はファイルだった場合など readdirSync は投げうるが、収集処理を
  // 止めたくないので「見つからなかった」扱いに倒す。
  try {
    for (const dir of readdirSync(projectsDir)) {
      const p = join(projectsDir, dir, `${sessionId}.jsonl`);
      if (existsSync(p)) return p;
    }
  } catch {
    return null;
  }
  return null;
}

function contentText(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const texts = content
    .map(asRec)
    .filter((b): b is Rec => b !== null && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string);
  return texts.length ? texts.join('\n') : null;
}

const isHumanPrompt = (r: Rec): boolean =>
  r.type === 'user' && r.isSidechain !== true && r.isMeta !== true && asRec(r.origin)?.kind === 'human';

export function extractHead(records: unknown[]): { originalPrompt: string | null } {
  for (const raw of records) {
    const r = asRec(raw);
    if (r && isHumanPrompt(r)) {
      const text = contentText(asRec(r.message)?.content);
      if (text) return { originalPrompt: text.trim() };
    }
  }
  return { originalPrompt: null };
}

export function extractTail(records: unknown[]): Omit<TranscriptSummary, 'originalPrompt'> {
  // latestPrompt は単一の変数として、人間の発話と last-prompt マーカーのどちらが
  // 来ても記録順（＝時系列順）に上書きする。片方を常に優先する実装だと、
  // マーカーの後に別の human 発話が続いた場合に古い方を返してしまう。
  let latestPrompt: string | null = null;
  let lastAssistantText: string | null = null;
  let lastTimestamp: number | null = null;
  let model: string | null = null;
  const openQuestions = new Map<string, string>();
  for (const raw of records) {
    const r = asRec(raw);
    if (!r) continue;
    const ts = time(r.timestamp);
    if (ts !== null) lastTimestamp = Math.max(lastTimestamp ?? 0, ts);
    if (r.type === 'last-prompt') {
      latestPrompt = str(r.lastPrompt) ?? latestPrompt;
      continue;
    }
    if (r.isSidechain === true) continue;
    const msg = asRec(r.message);
    if (!msg) continue;
    if (isHumanPrompt(r)) {
      latestPrompt = contentText(msg.content)?.trim() ?? latestPrompt;
      continue;
    }
    if (r.type === 'assistant' && Array.isArray(msg.content)) {
      model = str(msg.model) ?? model;
      const text = contentText(msg.content);
      if (text) lastAssistantText = text.split('\n')[0]?.trim() ?? null;
      for (const block of msg.content.map(asRec)) {
        if (block?.type === 'tool_use' && block.name === 'AskUserQuestion' && typeof block.id === 'string') {
          // questions は本来配列だが、記録の形は保証されないため配列以外は
          // 空リスト扱いにする（.map を直接呼ぶと非配列で例外になる）。
          const questionsRaw = asRec(block.input)?.questions;
          const qs = Array.isArray(questionsRaw) ? questionsRaw : [];
          const text = qs
            .map(asRec)
            .map((q) => str(q?.question))
            .filter((q): q is string => q !== null)
            .join(' / ');
          openQuestions.set(block.id, text);
        }
      }
      continue;
    }
    if (r.type === 'user' && Array.isArray(msg.content)) {
      for (const block of msg.content.map(asRec)) {
        if (block?.type === 'tool_result' && typeof block.tool_use_id === 'string') openQuestions.delete(block.tool_use_id);
      }
    }
  }
  const pendingQuestion = [...openQuestions.values()].at(-1) ?? null;
  return { latestPrompt, lastAssistantText, pendingQuestion, lastTimestamp, model };
}

export function readTranscriptSummary(path: string, cache: TranscriptCache): SourceResult<TranscriptSummary> {
  // fileSize 自体も existsSync と statSync の間でファイルが消えると例外を投げうるため、
  // 呼び出しごと捕捉する（TOCTOU）。ENOENT/ENOTDIR（本当に無くなった）だけを not_found
  // にし、それ以外（EISDIR 等、パスはあるのに読めない事情）は fs.ts の readJson と
  // 同じ基準（classifyIoError）で io_error にする。
  let size: number | null;
  try {
    size = fileSize(path);
  } catch (e) {
    const { type, detail } = classifyIoError(e, path);
    return fail(type, detail);
  }
  if (size === null) return fail('not_found', path);
  const hit = cache.get(path);
  if (hit && hit.size === size) return ok(hit.summary);
  // fileSize から読み取りまでの間にファイルが消える、あるいは実はディレクトリだった
  // といった TOCTOU は避けられないため、readHead/readTail の例外もここで同じ基準に
  // 分類し、他セッションの収集を止めないようにする。
  let head: unknown[];
  let tail: unknown[];
  try {
    head = parseJsonl(readHead(path, HEAD_BYTES));
    tail = size <= HEAD_BYTES ? head : parseJsonl(readTail(path, TAIL_BYTES));
  } catch (e) {
    const { type, detail } = classifyIoError(e, path);
    return fail(type, detail);
  }
  // レコードの形が想定外で抽出処理自体が例外を投げた場合は、ファイルの欠落とは
  // 別の失敗として分類する（malformed data と TOCTOU を混同させない）。
  let summary: TranscriptSummary;
  try {
    summary = { ...extractHead(head), ...extractTail(tail) };
  } catch (e) {
    return fail('parse_error', `${path}: ${(e as Error).message}`);
  }
  cache.set(path, { size, summary });
  return ok(summary);
}
