import { existsSync, readdirSync, type Dirent } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readJson } from './fs';
import { fail, ok, type SourceResult } from './types';

export type ClaudeJobState = 'working' | 'blocked' | 'done' | 'failed' | 'stopped' | 'unknown';

export type ClaudeJob = {
  id: string;
  sessionId: string | null;
  name: string | null;
  state: ClaudeJobState;
  detail: string | null;
  intent: string | null;
  outputResult: string | null;
  cwd: string | null;
  worktreePath: string | null;
  worktreeBranch: string | null;
  children: { id: string; href: string; kind: string }[];
  createdAt: number | null;
  updatedAt: number | null;
  transcriptPath: string | null;
  model: string | null;
};

const STATES: readonly ClaudeJobState[] = ['working', 'blocked', 'done', 'failed', 'stopped'];

export const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
export const time = (v: unknown): number | null => {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};

export function parseClaudeJob(id: string, raw: unknown): ClaudeJob | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const state = str(r.state);
  const output = (r.output ?? null) as Record<string, unknown> | null;
  const children = Array.isArray(r.children)
    ? r.children
        // 要素は null や配列などの非オブジェクトになりうる（state.json はバージョン間で
        // 形が揺れる）ため、プロパティを読む前にオブジェクトかどうかを確定させる。
        .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
        .filter((c) => typeof c.href === 'string')
        // id/kind は toString をカスタムプロパティで潰した値（例: { toString: 0 }）が
        // 混ざりうる。String() へそのまま渡すと変換できずに例外になるため、
        // string/number（または未指定）だけを許可し、それ以外の子は丸ごと飛ばす。
        .filter((c) => c.id === undefined || typeof c.id === 'string' || typeof c.id === 'number')
        .filter((c) => c.kind === undefined || typeof c.kind === 'string' || typeof c.kind === 'number')
        .map((c) => ({ id: String(c.id ?? ''), href: String(c.href), kind: String(c.kind ?? 'link') }))
    : [];
  // respawnFlags は CLI 起動引数の配列で、--model の値はモデル固有のフラグでは
  // なく次要素として渡されるため、位置で探す必要がある。要素は他プロセスが書いた
  // JSON 由来で文字列とは限らない（toString をカスタムプロパティで潰したオブジェクト等）
  // ため、String() へ渡さず文字列でない要素はそのまま読み飛ばす。
  const flags = Array.isArray(r.respawnFlags) ? r.respawnFlags.filter((f): f is string => typeof f === 'string') : [];
  const modelIdx = flags.indexOf('--model');
  return {
    id,
    sessionId: str(r.sessionId),
    name: str(r.name),
    state: STATES.includes(state as ClaudeJobState) ? (state as ClaudeJobState) : 'unknown',
    detail: str(r.detail),
    intent: str(r.intent),
    outputResult: str(output?.result),
    cwd: str(r.cwd),
    worktreePath: str(r.worktreePath),
    worktreeBranch: str(r.worktreeBranch),
    children,
    createdAt: time(r.createdAt),
    updatedAt: time(r.updatedAt),
    transcriptPath: str(r.linkScanPath),
    model: modelIdx >= 0 ? (flags[modelIdx + 1] ?? null) : null,
  };
}

export const defaultJobsDir = () => join(homedir(), '.claude', 'jobs');

export async function collectClaudeJobs(jobsDir = defaultJobsDir()): Promise<SourceResult<ClaudeJob[]>> {
  if (!existsSync(jobsDir)) return fail('not_found', jobsDir);
  let entries: Dirent[];
  try {
    // jobsDir は existsSync 通過後も、通常ファイルだったり削除される可能性がある
    // （TOCTOU）。readdirSync の例外はここで分類し、呼び出し元へは投げない。
    entries = readdirSync(jobsDir, { withFileTypes: true });
  } catch (e) {
    return fail('not_found', `${jobsDir}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
  }
  const jobs: ClaudeJob[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const r = readJson(join(jobsDir, entry.name, 'state.json'));
    // 1 ジョブの state.json が欠損・破損していても、他の正常なジョブの一覧表示を
    // 止めてはいけないため、そのジョブだけを飛ばして続行する。
    if (!r.ok) continue;
    const job = parseClaudeJob(entry.name, r.value);
    if (job) jobs.push(job);
  }
  return ok(jobs);
}
