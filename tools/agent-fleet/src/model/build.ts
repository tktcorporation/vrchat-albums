import { match } from 'ts-pattern';
import type { ClaudeAgentEntry } from '../collect/claude-agents-cli';
import type { ClaudeJob } from '../collect/claude-jobs';
import type { ClaudeSession } from '../collect/claude-sessions';
import type { CodexThread } from '../collect/codex';
import type { HerdrAgent } from '../collect/herdr';
import type { TranscriptSummary } from '../collect/transcript';
import { branchForCwd, relativeLocation, type WorktreeInfo } from '../collect/worktrees';
import type { FleetRow, RowStatus } from './row';

export type BuildInput = {
  workspaceRoot: string;
  jobs: ClaudeJob[];
  sessions: ClaudeSession[];
  agentsCli: ClaudeAgentEntry[];
  transcripts: Map<string, TranscriptSummary>;
  codex: CodexThread[];
  herdr: HerdrAgent[];
  worktrees: WorktreeInfo[];
};

export function displayName(name: string | null, originalPrompt: string | null): string {
  if (name) return name;
  const head = originalPrompt?.replace(/\s+/g, ' ').trim();
  return head ? [...head].slice(0, 30).join('') : '(no name)';
}

type PaneIndex = { bySession: Map<string, HerdrAgent>; byCwdUnique: Map<string, HerdrAgent> };

// 紐づけの鍵は agent_session（integration hook 由来）。無い pane は cwd で照合するしかないが、
// pane 側だけでなく session 側も同じ cwd で 1 件に絞れないと、どのセッションの pane か決められない。
// 例えば同じ cwd で 2 つの対話セッションが動いていると、1 つの pane をどちらに付けても誤りうる
// ため、両側とも一意なときだけ紐づける。
function indexPanes(herdr: HerdrAgent[], sessions: ClaudeSession[]): PaneIndex {
  const bySession = new Map<string, HerdrAgent>();
  const paneCwdCount = new Map<string, number>();
  const byCwd = new Map<string, HerdrAgent>();
  for (const a of herdr) {
    if (a.sessionId) bySession.set(a.sessionId, a);
    else if (a.agent === 'claude') {
      paneCwdCount.set(a.cwd, (paneCwdCount.get(a.cwd) ?? 0) + 1);
      byCwd.set(a.cwd, a);
    }
  }
  const sessionCwdCount = new Map<string, number>();
  for (const s of sessions) sessionCwdCount.set(s.cwd, (sessionCwdCount.get(s.cwd) ?? 0) + 1);
  const byCwdUnique = new Map<string, HerdrAgent>();
  for (const [cwd, a] of byCwd) {
    if (paneCwdCount.get(cwd) === 1 && sessionCwdCount.get(cwd) === 1) byCwdUnique.set(cwd, a);
  }
  return { bySession, byCwdUnique };
}

const herdrStatus = (s: HerdrAgent['status']): RowStatus =>
  match(s)
    .with('working', () => 'working' as const)
    .with('blocked', () => 'blocked' as const)
    .with('done', () => 'done' as const)
    .with('idle', 'unknown', () => 'idle' as const)
    .exhaustive();

// herdrStatus() は unknown を idle に丸めるため、行の status だけを見ても
// 「本当に暇なのか、Herdr が判定できていないだけなのか」が消えてしまう。
// blocked/done も画面照合による推定にすぎないため、由来を人が見える形で残す。
const herdrStatusNote = (status: RowStatus, rawStatus: HerdrAgent['status']): string | null => {
  if (rawStatus === 'unknown') return '判定不能';
  if (status === 'blocked' || status === 'done') return 'Herdr 検知';
  return null;
};

export function buildRows(input: BuildInput): FleetRow[] {
  const panes = indexPanes(input.herdr, input.sessions);
  const cliById = new Map(input.agentsCli.filter((e) => e.id).map((e) => [e.id as string, e]));
  const location = (cwd: string, paneId: string | null, branchHint: string | null) => ({
    cwd,
    display: relativeLocation(input.workspaceRoot, cwd),
    branch: branchHint ?? branchForCwd(input.worktrees, cwd)?.branch ?? null,
    paneId,
  });
  const rows: FleetRow[] = [];

  for (const job of input.jobs) {
    const pane = job.sessionId ? panes.bySession.get(job.sessionId) ?? null : null;
    const status: RowStatus = job.state === 'unknown' ? 'idle' : job.state;
    const cwd = job.worktreePath ?? job.cwd ?? input.workspaceRoot;
    rows.push({
      key: `claude-bg:${job.id}`,
      agent: 'claude',
      kind: 'background',
      name: displayName(job.name, job.intent),
      model: job.model,
      status,
      statusSource: 'job',
      statusNote: null,
      originalPrompt: job.intent,
      latestPrompt: null,
      activity: job.detail ?? job.outputResult,
      pending: status === 'blocked' ? { kind: cliById.get(job.id)?.waitingFor ?? 'blocked', text: job.detail } : null,
      location: location(cwd, pane?.paneId ?? null, job.worktreeBranch),
      artifacts: job.children,
      startedAt: job.createdAt,
      updatedAt: job.updatedAt,
      doneMarker: status === 'done' && job.updatedAt !== null ? String(job.updatedAt) : null,
      attach: pane ? { type: 'focus', paneId: pane.paneId } : { type: 'claude-attach', jobId: job.id },
    });
  }

  for (const s of input.sessions) {
    const t = input.transcripts.get(s.sessionId) ?? null;
    const pane = panes.bySession.get(s.sessionId) ?? panes.byCwdUnique.get(s.cwd) ?? null;
    let status: RowStatus;
    let statusSource: FleetRow['statusSource'];
    let pending: FleetRow['pending'] = null;
    if (t?.pendingQuestion) {
      status = 'blocked';
      statusSource = 'transcript';
      pending = { kind: 'input needed', text: t.pendingQuestion };
    } else if (pane) {
      status = herdrStatus(pane.status);
      statusSource = 'herdr';
      if (status === 'blocked') pending = { kind: 'herdr-blocked', text: t?.lastAssistantText ?? null };
    } else {
      status = s.status === 'busy' ? 'working' : 'idle';
      statusSource = 'session';
    }
    rows.push({
      key: `claude:${s.sessionId}`,
      agent: 'claude',
      kind: 'interactive',
      name: displayName(s.name, t?.originalPrompt ?? null),
      model: t?.model ?? null,
      status,
      statusSource,
      statusNote: statusSource === 'herdr' && pane ? herdrStatusNote(status, pane.status) : null,
      originalPrompt: t?.originalPrompt ?? null,
      latestPrompt: t?.latestPrompt ?? null,
      activity: t?.lastAssistantText ?? null,
      pending,
      location: location(s.cwd, pane?.paneId ?? null, null),
      artifacts: [],
      startedAt: s.startedAt,
      updatedAt: t?.lastTimestamp ?? s.updatedAt,
      doneMarker: status === 'done' && pane?.stateChangeSeq != null ? String(pane.stateChangeSeq) : null,
      attach: pane ? { type: 'focus', paneId: pane.paneId } : { type: 'hint', text: `claude --resume ${s.sessionId}` },
    });
  }

  const codexById = new Map(input.codex.map((c) => [c.threadId, c]));
  for (const pane of input.herdr) {
    if (pane.agent !== 'codex' || !pane.sessionId) continue;
    const c = codexById.get(pane.sessionId) ?? null;
    const status = herdrStatus(pane.status);
    const cwd = c?.cwd ?? pane.cwd;
    rows.push({
      key: `codex:${pane.sessionId}`,
      agent: 'codex',
      kind: 'interactive',
      name: displayName(c?.name ?? pane.name ?? pane.title, c?.originalPrompt ?? null),
      model: c?.model ?? null,
      status,
      statusSource: 'herdr',
      statusNote: herdrStatusNote(status, pane.status),
      originalPrompt: c?.originalPrompt ?? null,
      latestPrompt: c?.latestPrompt ?? null,
      activity: c?.inProgress ? '作業中' : c?.lastAgentMessage ?? null,
      pending: status === 'blocked' ? { kind: 'herdr-blocked', text: c?.lastAgentMessage ?? null } : null,
      location: location(cwd, pane.paneId, c?.branch ?? null),
      artifacts: [],
      startedAt: null,
      updatedAt: c?.lastEventAt ?? null,
      doneMarker: status === 'done' && pane.stateChangeSeq != null ? String(pane.stateChangeSeq) : null,
      attach: { type: 'focus', paneId: pane.paneId },
    });
  }
  return rows;
}
