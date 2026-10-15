import { str } from './claude-jobs';
import { runCommand } from './exec';
import { fail, ok, type SourceResult } from './types';

export type HerdrStatus = 'idle' | 'working' | 'blocked' | 'done' | 'unknown';

export type HerdrAgent = {
  paneId: string;
  workspaceId: string;
  agent: string;
  status: HerdrStatus;
  cwd: string;
  name: string | null;
  title: string | null;
  sessionId: string | null;
  stateChangeSeq: number | null;
};

const STATUSES: readonly HerdrStatus[] = ['idle', 'working', 'blocked', 'done'];

// 未検証な JSON から安全にプロパティを読むためのガード。配列は typeof 'object' を
// 満たすが、agent エントリとしては不正なので明示的に弾く。
const asRec = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

export function parseHerdrAgentList(text: string): SourceResult<HerdrAgent[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    // JSON 構文エラーだけを予期された失敗として分類する。それ以外（メモリ不足等）は
    // このコレクタの責務外なので再スローし、上位の監視に届ける。
    if (e instanceof SyntaxError) return fail('parse_error', `herdr agent list: ${e.message}`);
    throw e;
  }
  const agents = asRec(asRec(raw)?.result)?.agents;
  if (!Array.isArray(agents)) return fail('parse_error', 'herdr agent list に agents 配列が無い');

  const out: HerdrAgent[] = [];
  for (const entry of agents) {
    // 1 要素が壊れていても他の pane の情報は出し続けたいので、ここでは
    // 例外を投げず単に skip する（呼び出し元は集計結果全体の欠落として扱う）。
    const a = asRec(entry);
    const paneId = str(a?.pane_id);
    const cwd = str(a?.cwd);
    if (!a || !paneId || !cwd) continue;

    const status = str(a.agent_status);
    out.push({
      paneId,
      workspaceId: str(a.workspace_id) ?? '',
      agent: str(a.agent) ?? 'unknown',
      status: STATUSES.find((candidate) => candidate === status) ?? 'unknown',
      cwd,
      name: str(a.name),
      title: str(a.terminal_title_stripped),
      // agent_session は Herdr の integration hook が入っているときだけ付く。
      // これが Claude の sessionId / Codex の thread id と各記録を結ぶ鍵になる。
      sessionId: str(asRec(a.agent_session)?.value),
      stateChangeSeq: typeof a.state_change_seq === 'number' ? a.state_change_seq : null,
    });
  }
  return ok(out);
}

export async function collectHerdrAgents(run = runCommand): Promise<SourceResult<HerdrAgent[]>> {
  const r = await run(['herdr', 'agent', 'list'], 3000);
  if (!r.ok) return r;
  return parseHerdrAgentList(r.value);
}
