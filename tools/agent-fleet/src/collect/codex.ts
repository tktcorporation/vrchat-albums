import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { str, time } from './claude-jobs';
import { fileSize, parseJsonl, readHead, readTail } from './fs';
import { fail, ok, type SourceResult } from './types';

// rollout / history / session_index はサイズが数百 KB〜数 MB に育ちうる。
// 5 秒間隔の収集ごとに全 thread を読み直すと、pane 数が増えるほど I/O が
// 線形に増えるため、ファイルサイズが変わっていない間は前回のパース結果を使い回す。
export type RolloutHead = ReturnType<typeof extractRolloutHead>;
export type RolloutTail = ReturnType<typeof extractRolloutTail>;
export type CodexCache = {
  rolloutPath: Map<string, string>;
  summaries: Map<string, { size: number; head: RolloutHead; tail: RolloutTail }>;
  history: { size: number; map: Map<string, { first: string; last: string }> } | null;
  index: { size: number; map: Map<string, string> } | null;
};

export function createCodexCache(): CodexCache {
  return { rolloutPath: new Map(), summaries: new Map(), history: null, index: null };
}

export type CodexThread = {
  threadId: string;
  name: string | null;
  originalPrompt: string | null;
  latestPrompt: string | null;
  cwd: string | null;
  branch: string | null;
  lastAgentMessage: string | null;
  inProgress: boolean;
  lastEventAt: number | null;
  forkedFromId: string | null;
  model: string | null;
};

type Rec = Record<string, unknown>;
// レコードは他プロセス（codex CLI）が書いた JSONL なので、形が保証されない。
// プロパティアクセス前に object であることを確かめる。
const asRec = (v: unknown): Rec | null => (typeof v === 'object' && v !== null ? (v as Rec) : null);

export function parseHistory(text: string): Map<string, { first: string; last: string }> {
  const out = new Map<string, { first: string; last: string }>();
  for (const raw of parseJsonl(text)) {
    const r = asRec(raw);
    const id = str(r?.session_id);
    const t = str(r?.text);
    if (!id || !t) continue;
    const cur = out.get(id);
    out.set(id, cur ? { first: cur.first, last: t } : { first: t, last: t });
  }
  return out;
}

export function parseSessionIndex(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of parseJsonl(text)) {
    const r = asRec(raw);
    const id = str(r?.id);
    const name = str(r?.thread_name);
    if (id && name) out.set(id, name);
  }
  return out;
}

export function extractRolloutHead(
  records: unknown[],
): { cwd: string | null; branch: string | null; forkedFromId: string | null } {
  for (const raw of records) {
    const r = asRec(raw);
    if (r?.type !== 'session_meta') continue;
    const p = asRec(r.payload);
    return { cwd: str(p?.cwd), branch: str(asRec(p?.git)?.branch), forkedFromId: str(p?.forked_from_id) };
  }
  return { cwd: null, branch: null, forkedFromId: null };
}

export function extractRolloutTail(
  records: unknown[],
): { lastAgentMessage: string | null; inProgress: boolean; lastEventAt: number | null; model: string | null } {
  let lastAgentMessage: string | null = null;
  let inProgress = false;
  let lastEventAt: number | null = null;
  let model: string | null = null;
  for (const raw of records) {
    const r = asRec(raw);
    if (r?.type === 'turn_context') {
      // model は turn ごとに書き直されるので、最後に見つかったものを残す
      model = str(asRec(r.payload)?.model) ?? model;
      continue;
    }
    if (r?.type !== 'event_msg') continue;
    const p = asRec(r.payload);
    const ts = time(r.timestamp);
    if (ts !== null) lastEventAt = Math.max(lastEventAt ?? 0, ts);
    if (p?.type === 'task_started') inProgress = true;
    if (p?.type === 'task_complete') {
      inProgress = false;
      const msg = str(p.last_agent_message);
      if (msg) lastAgentMessage = msg.split('\n')[0]?.trim() ?? null;
    }
  }
  return { lastAgentMessage, inProgress, lastEventAt, model };
}

// readdirSync/statSync は他プロセスとの競合（探索中にディレクトリが消える・
// 権限が無い等）で個別に例外を投げうる。1 か所でも読めないディレクトリがあると
// 他の日付ディレクトリの探索まで止まってしまうため、catch は呼び出しごとに
// 個別に置き、失敗したエントリだけを「無い」ものとしてスキップして探索を続ける。
function safeReaddir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function isDirectorySafe(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

// rollout は sessions/YYYY/MM/DD/rollout-<時刻>-<thread id>.jsonl に置かれる。
// 新しい日付から探すのは、生きている thread はほぼ直近だから。
export function findRolloutPath(sessionsDir: string, threadId: string): string | null {
  const suffix = `-${threadId}.jsonl`;
  if (!existsSync(sessionsDir)) return null;
  const listSubdirs = (p: string) =>
    safeReaddir(p)
      .filter((n) => isDirectorySafe(join(p, n)))
      .sort()
      .reverse();
  for (const y of listSubdirs(sessionsDir)) {
    for (const m of listSubdirs(join(sessionsDir, y))) {
      for (const d of listSubdirs(join(sessionsDir, y, m))) {
        const dir = join(sessionsDir, y, m, d);
        const hit = safeReaddir(dir).find((n) => n.startsWith('rollout-') && n.endsWith(suffix));
        if (hit) return join(dir, hit);
      }
    }
  }
  return null;
}

const ROLLOUT_BYTES = 256 * 1024;

const emptyHead = { cwd: null, branch: null, forkedFromId: null };
const emptyTail = { lastAgentMessage: null, inProgress: false, lastEventAt: null, model: null };

// rollout の読み取りは 1 thread 分の付加情報にすぎない。読めなくても history /
// session_index だけで行を出せるようにするため、失敗は「rollout 無し」として
// 空のデフォルト値に倒し、他の thread の収集を止めない。
// ファイルサイズが前回と変わっていなければ内容も変わっていないとみなし、
// 数百 KB になりうる rollout の再読み取り・再パースを省く。
function readRollout(path: string, cache: CodexCache): { head: RolloutHead; tail: RolloutTail } {
  try {
    const size = fileSize(path);
    if (size === null) return { head: emptyHead, tail: emptyTail };
    const hit = cache.summaries.get(path);
    if (hit && hit.size === size) return { head: hit.head, tail: hit.tail };
    const head = extractRolloutHead(parseJsonl(readHead(path, ROLLOUT_BYTES)));
    const tail = extractRolloutTail(
      parseJsonl(size <= ROLLOUT_BYTES ? readHead(path, ROLLOUT_BYTES) : readTail(path, ROLLOUT_BYTES)),
    );
    cache.summaries.set(path, { size, head, tail });
    return { head, tail };
  } catch {
    return { head: emptyHead, tail: emptyTail };
  }
}

// findRolloutPath は sessions/ 配下を年月日で総当たりする、pane 数が増えると
// 効いてくる探索。一度見つかったパスは、そのファイルが消えない限り変わらない
// （thread id ごとに 1 ファイル）ため、存在確認だけで再利用する。
function resolveRolloutPath(sessionsDir: string, threadId: string, cache: CodexCache): string | null {
  const cached = cache.rolloutPath.get(threadId);
  if (cached && existsSync(cached)) return cached;
  const found = findRolloutPath(sessionsDir, threadId);
  if (found) cache.rolloutPath.set(threadId, found);
  else cache.rolloutPath.delete(threadId);
  return found;
}

export const defaultCodexHome = () => process.env.CODEX_HOME ?? join(homedir(), '.codex');

// history.jsonl / session_index.jsonl は Codex 側の付加情報にすぎない。existsSync
// の後でも、ディレクトリだった・権限が無い・読み取り中に削除された等で
// Bun.file(...).text() は失敗しうる。失敗した方は「無い」ものとして空の Map に
// 倒し、rollout 由来のフィールドだけでも thread の行を返せるようにする。
// history.jsonl は全 thread の発話ログを 1 ファイルに追記していくため、pane 数に
// 関わらずファイル自体が大きくなりやすい。サイズが変わっていない間は前回の
// パース結果を再利用する。
async function readCachedMap<V>(
  path: string,
  parse: (text: string) => Map<string, V>,
  cached: { size: number; map: Map<string, V> } | null,
): Promise<{ size: number; map: Map<string, V> } | null> {
  if (!existsSync(path)) return null;
  // fileSize は existsSync 通過後も、統計取得までの間にファイルが消える・種別が
  // 変わるといった TOCTOU で例外を投げうる。ここを素通しにすると history.jsonl /
  // session_index.jsonl の 1 ファイルの一時的な消失で collectCodexThreads 全体が
  // reject し、rollout 由来のフィールドだけの thread すら返せなくなる。他の
  // 分類済み読み取り（readJson・readTranscriptSummary）と同じく、例外は「無い」
  // ものとして握りつぶし、呼び出し側は空の Map にフォールバックできるようにする。
  let size: number | null;
  try {
    size = fileSize(path);
  } catch {
    return null;
  }
  if (size !== null && cached && cached.size === size) return cached;
  try {
    const map = parse(await Bun.file(path).text());
    return { size: size ?? 0, map };
  } catch {
    return null;
  }
}

export async function collectCodexThreads(
  threadIds: string[],
  codexHome = defaultCodexHome(),
  cache: CodexCache = createCodexCache(),
): Promise<SourceResult<CodexThread[]>> {
  if (!existsSync(codexHome)) return fail('not_found', codexHome);
  cache.history = await readCachedMap(join(codexHome, 'history.jsonl'), parseHistory, cache.history);
  cache.index = await readCachedMap(join(codexHome, 'session_index.jsonl'), parseSessionIndex, cache.index);
  const history = cache.history?.map ?? new Map<string, { first: string; last: string }>();
  const index = cache.index?.map ?? new Map<string, string>();
  const sessionsDir = join(codexHome, 'sessions');
  const threads: CodexThread[] = [];
  for (const threadId of threadIds) {
    const path = resolveRolloutPath(sessionsDir, threadId, cache);
    const { head, tail } = path ? readRollout(path, cache) : { head: emptyHead, tail: emptyTail };
    // fork で作られた thread は history に自分の行が無いので、親を 1 段だけ辿る
    const own = history.get(threadId) ?? (head.forkedFromId ? history.get(head.forkedFromId) : undefined);
    threads.push({
      threadId,
      name: index.get(threadId) ?? null,
      originalPrompt: own?.first ?? null,
      latestPrompt: history.get(threadId)?.last ?? own?.last ?? null,
      cwd: head.cwd,
      branch: head.branch,
      lastAgentMessage: tail.lastAgentMessage,
      inProgress: tail.inProgress,
      lastEventAt: tail.lastEventAt,
      forkedFromId: head.forkedFromId,
      model: tail.model,
    });
  }
  return ok(threads);
}
