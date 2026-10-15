import { homedir } from 'node:os';
import { join } from 'node:path';
import { collectClaudeAgents, type ClaudeAgentEntry } from '../collect/claude-agents-cli';
import { collectClaudeJobs, type ClaudeJob } from '../collect/claude-jobs';
import { collectClaudeSessions, type ClaudeSession } from '../collect/claude-sessions';
import { collectCodexThreads, createCodexCache, defaultCodexHome, type CodexCache, type CodexThread } from '../collect/codex';
import { collectHerdrAgents, type HerdrAgent } from '../collect/herdr';
import { findTranscriptPath, readTranscriptSummary, type TranscriptCache, type TranscriptSummary } from '../collect/transcript';
import { fail, type SourceError, type SourceResult } from '../collect/types';
import { collectWorktrees, type WorktreeInfo } from '../collect/worktrees';
import { buildRows } from './build';
import type { Snapshot } from './row';

export type CollectorDeps = {
  workspaceRoot: string;
  now: () => number;
  jobs: () => Promise<SourceResult<ClaudeJob[]>>;
  sessions: () => Promise<SourceResult<ClaudeSession[]>>;
  agentsCli: () => Promise<SourceResult<ClaudeAgentEntry[]>>;
  herdr: () => Promise<SourceResult<HerdrAgent[]>>;
  codex: (threadIds: string[]) => Promise<SourceResult<CodexThread[]>>;
  worktrees: () => Promise<SourceResult<WorktreeInfo[]>>;
  transcript: (path: string) => SourceResult<TranscriptSummary>;
  findTranscript: (cwd: string, sessionId: string) => string | null;
};

// 遅い源は間引く。claude agents --json は 250ms、git worktree list はサブモジュール分だけ増える。
const AGENTS_CLI_INTERVAL_MS = 10_000;
const WORKTREES_INTERVAL_MS = 30_000;

export function defaultCollectorDeps(workspaceRoot: string): CollectorDeps {
  const projectsDir = join(homedir(), '.claude', 'projects');
  const cache: TranscriptCache = new Map();
  const codexCache: CodexCache = createCodexCache();
  return {
    workspaceRoot,
    now: () => Date.now(),
    jobs: () => collectClaudeJobs(),
    sessions: () => collectClaudeSessions(),
    agentsCli: () => collectClaudeAgents(),
    herdr: () => collectHerdrAgents(),
    codex: (ids) => collectCodexThreads(ids, defaultCodexHome(), codexCache),
    // 他リポジトリではサブモジュール置き場が 'repo' と異なる、または存在しないことがあるため
    // 環境変数で上書き可能にしている（未設定時は従来どおり 'repo'）。
    worktrees: () => collectWorktrees(workspaceRoot, undefined, process.env.AGENT_FLEET_SUBMODULE_DIR?.trim() || 'repo'),
    transcript: (path) => readTranscriptSummary(path, cache),
    findTranscript: (cwd, sessionId) => findTranscriptPath(projectsDir, cwd, sessionId),
  };
}

type Cached<T> = { at: number; result: SourceResult<T> } | null;

// throw された値は Error とは限らない（reject(null) や reject('x') もありうる）。
// e.message をそのまま使うと Error 以外で undefined になるため、表示可能な文字列に正規化する。
const toDetail = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// deps の各関数は SourceResult を返す契約だが、依存先の実装ミスや Bun 側の
// 予期しない例外まではその契約で守れない。1 源が想定外に throw しても他の源の
// 行を出し続けられるよう、collect() 全体では確実に落ちない形に分類してから使う。
async function safely<T>(fetch: () => Promise<SourceResult<T>>): Promise<SourceResult<T>> {
  try {
    return await fetch();
  } catch (e) {
    return fail('not_running', toDetail(e));
  }
}

// findTranscript/transcript は同期関数なので async の safely は使えないが、
// 同じ理由（依存先の想定外の throw で collect() 全体を落とさない）で境界を分類する。
function safelySync<T>(run: () => T): SourceResult<T> {
  try {
    return { ok: true, value: run() };
  } catch (e) {
    return fail('not_running', toDetail(e));
  }
}

export function createCollector(deps: CollectorDeps): { collect(): Promise<Snapshot> } {
  let agentsCli: Cached<ClaudeAgentEntry[]> = null;
  let worktrees: Cached<WorktreeInfo[]> = null;
  const refresh = async <T>(cached: Cached<T>, interval: number, now: number, fetch: () => Promise<SourceResult<T>>) =>
    cached && now - cached.at < interval ? cached : { at: now, result: await safely(fetch) };

  return {
    async collect() {
      const now = deps.now();
      const [jobs, sessions, herdr] = await Promise.all([safely(deps.jobs), safely(deps.sessions), safely(deps.herdr)]);
      agentsCli = await refresh(agentsCli, AGENTS_CLI_INTERVAL_MS, now, deps.agentsCli);
      worktrees = await refresh(worktrees, WORKTREES_INTERVAL_MS, now, deps.worktrees);
      const herdrAgents = herdr.ok ? herdr.value : [];
      const codexIds = herdrAgents.filter((a) => a.agent === 'codex' && a.sessionId).map((a) => a.sessionId as string);
      const codex = codexIds.length ? await safely(() => deps.codex(codexIds)) : null;

      const transcripts = new Map<string, TranscriptSummary>();
      const transcriptErrors: SourceError[] = [];
      const jobList = jobs.ok ? jobs.value : [];
      const sessionList = sessions.ok ? sessions.value : [];
      for (const s of sessionList) {
        const pathResult = safelySync(() => deps.findTranscript(s.cwd, s.sessionId));
        if (!pathResult.ok) {
          transcriptErrors.push(pathResult.error);
          continue;
        }
        const path = pathResult.value;
        if (!path) continue; // セッションがまだ transcript を持たないのは正常系（起動直後など）
        const result = safelySync<SourceResult<TranscriptSummary>>(() => deps.transcript(path));
        if (!result.ok) {
          transcriptErrors.push(result.error);
          continue;
        }
        const inner = result.value;
        if (inner.ok) transcripts.set(s.sessionId, inner.value);
        // not_found はセッションに対応する transcript がまだ書かれていないだけの正常系。
        // それ以外（parse_error など）は表示すべき異常として集計する。
        else if (inner.error.type !== 'not_found') transcriptErrors.push(inner.error);
      }
      const rows = buildRows({
        workspaceRoot: deps.workspaceRoot,
        jobs: jobList,
        sessions: sessionList,
        agentsCli: agentsCli.result.ok ? agentsCli.result.value : [],
        transcripts,
        codex: codex?.ok ? codex.value : [],
        herdr: herdrAgents,
        worktrees: worktrees.result.ok ? worktrees.result.value : [],
      });
      // transcript は 1 件のセッションの失敗が他の行を隠さないよう個別に握る。
      // 表示は代表 1 件に留め、見落とし件数が分かるよう detail の先頭に件数を付ける。
      const [firstTranscriptError] = transcriptErrors;
      const transcriptsSource: SourceError | null = firstTranscriptError
        ? { type: firstTranscriptError.type, detail: `${transcriptErrors.length} 件: ${firstTranscriptError.detail}` }
        : null;
      return {
        rows,
        sources: {
          herdr: herdr.ok ? null : herdr.error,
          claudeAgents: agentsCli.result.ok ? null : agentsCli.result.error,
          claudeJobs: jobs.ok ? null : jobs.error,
          claudeSessions: sessions.ok ? null : sessions.error,
          codex: codex && !codex.ok ? codex.error : null,
          worktrees: worktrees.result.ok ? null : worktrees.result.error,
          transcripts: transcriptsSource,
        },
        collectedAt: now,
      };
    },
  };
}
