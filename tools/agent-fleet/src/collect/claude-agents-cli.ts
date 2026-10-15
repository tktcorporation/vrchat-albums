import { str } from './claude-jobs';
import { runCommand } from './exec';
import { fail, ok, type SourceResult } from './types';

export type ClaudeAgentEntry = {
  id: string | null;
  sessionId: string | null;
  pid: number | null;
  kind: string;
  status: string | null;
  state: string | null;
  waitingFor: string | null;
  name: string | null;
  cwd: string | null;
};

export function parseClaudeAgentsJson(text: string): SourceResult<ClaudeAgentEntry[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return fail('parse_error', `claude agents --json: ${(e as Error).message}`);
  }
  if (!Array.isArray(raw)) return fail('parse_error', 'claude agents --json が配列を返さなかった');
  const entries = raw
    // 要素は null や数値、配列などの非エントリになりうる（コマンド出力の形式変更や
    // 破損に備え）ため、プロパティを読む前にプレーンオブジェクトかどうかを確定させる。
    // 配列は typeof が 'object' を返すため Array.isArray で明示的に除外する。
    .filter((e): e is Record<string, unknown> => typeof e === 'object' && e !== null && !Array.isArray(e))
    .map((e) => ({
      id: str(e.id),
      sessionId: str(e.sessionId),
      pid: typeof e.pid === 'number' ? e.pid : null,
      kind: str(e.kind) ?? 'unknown',
      status: str(e.status),
      state: str(e.state),
      waitingFor: str(e.waitingFor),
      name: str(e.name),
      cwd: str(e.cwd),
    }));
  return ok(entries);
}

// `claude agents --json` は待ちの種別（waitingFor）を唯一持つ源だが 250ms ほどかかる。
// 呼ぶ頻度は collector 側で落とす（10 秒ごと）。
export async function collectClaudeAgents(run = runCommand): Promise<SourceResult<ClaudeAgentEntry[]>> {
  const r = await run(['claude', 'agents', '--json', '--all'], 5000);
  if (!r.ok) return r;
  return parseClaudeAgentsJson(r.value);
}
