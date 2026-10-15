import { describe, expect, test } from 'bun:test';
import type { ClaudeAgentEntry } from '../src/collect/claude-agents-cli';
import type { ClaudeJob } from '../src/collect/claude-jobs';
import type { ClaudeSession } from '../src/collect/claude-sessions';
import type { CodexThread } from '../src/collect/codex';
import type { HerdrAgent } from '../src/collect/herdr';
import type { TranscriptSummary } from '../src/collect/transcript';
import type { WorktreeInfo } from '../src/collect/worktrees';
import { buildRows, displayName, type BuildInput } from '../src/model/build';

const ws = '/workspaces/ws';
const job = (over: Partial<ClaudeJob>): ClaudeJob => ({
  id: 'job1', sessionId: 's-job1', name: 'design review', state: 'blocked', detail: '承認待ち: push してよいか',
  intent: 'ダミー指示', outputResult: null, cwd: `${ws}/.claude/worktrees/feature-a`, worktreePath: `${ws}/.claude/worktrees/feature-a`,
  worktreeBranch: 'feature-a', children: [{ id: '100', href: 'https://x/pull/100', kind: 'pr' }],
  createdAt: 1000, updatedAt: 2000, transcriptPath: null, model: 'claude-fable-5-1[1m]', ...over,
});
const session = (over: Partial<ClaudeSession>): ClaudeSession => ({
  pid: 1001, sessionId: 's-int', kind: 'interactive', name: 'feature-b work', status: 'busy',
  cwd: `${ws}/.claude/worktrees/feature-b`, jobId: null, startedAt: 500, updatedAt: 900, ...over,
});
const transcript = (over: Partial<TranscriptSummary>): TranscriptSummary => ({
  originalPrompt: '元の指示 int', latestPrompt: '進めて', lastAssistantText: 'テスト中', pendingQuestion: null, lastTimestamp: 950,
  model: 'claude-fable-5-1', ...over,
});
const herdr = (over: Partial<HerdrAgent>): HerdrAgent => ({
  paneId: 'w1:p1', workspaceId: 'w1', agent: 'claude', status: 'working', cwd: `${ws}/.claude/worktrees/feature-b`,
  name: null, title: 'feature-b work', sessionId: 's-int', stateChangeSeq: 10, ...over,
});
const codex = (over: Partial<CodexThread>): CodexThread => ({
  threadId: 'thread-1', name: '9月目標', originalPrompt: '元の指示 codex', latestPrompt: '続けて', cwd: '/home/u/.herdr/worktrees/ws/x',
  branch: 'worktree/x', lastAgentMessage: '章立てを直した', inProgress: false, lastEventAt: 800, forkedFromId: null,
  model: 'gpt-5.6-sol', ...over,
});
const worktrees: WorktreeInfo[] = [
  { path: ws, branch: 'main', repoRoot: ws },
  { path: `${ws}/.claude/worktrees/feature-b`, branch: 'feature/b', repoRoot: ws },
];
const base = (over: Partial<BuildInput>): BuildInput => ({
  workspaceRoot: ws, jobs: [], sessions: [], agentsCli: [], transcripts: new Map(), codex: [], herdr: [], worktrees, ...over,
});

describe('Claude 背景セッション', () => {
  test('state.json の値がそのまま行になり、waitingFor を pending.kind に足す', () => {
    const cli: ClaudeAgentEntry = { id: 'job1', sessionId: 's-job1', pid: 1, kind: 'background', status: 'waiting', state: 'blocked', waitingFor: 'permission prompt', name: null, cwd: null };
    const [row] = buildRows(base({ jobs: [job({})], agentsCli: [cli] }));
    expect(row).toMatchObject({
      key: 'claude-bg:job1', agent: 'claude', kind: 'background', status: 'blocked', statusSource: 'job',
      model: 'claude-fable-5-1[1m]',
      originalPrompt: 'ダミー指示', activity: '承認待ち: push してよいか',
      pending: { kind: 'permission prompt', text: '承認待ち: push してよいか' },
      location: { branch: 'feature-a', display: '.claude/worktrees/feature-a', paneId: null },
      artifacts: [{ kind: 'pr', id: '100', href: 'https://x/pull/100' }],
      attach: { type: 'claude-attach', jobId: 'job1' }, doneMarker: null,
    });
  });
  test('done は updatedAt を doneMarker にし、pending は無い', () => {
    const [row] = buildRows(base({ jobs: [job({ state: 'done', updatedAt: 3000 })] }));
    expect(row?.doneMarker).toBe('3000');
    expect(row?.pending).toBeNull();
  });
  test('unknown state は idle 扱いにする', () => {
    const [row] = buildRows(base({ jobs: [job({ state: 'unknown' })] }));
    expect(row?.status).toBe('idle');
  });
  test('Herdr の pane が sessionId で紐づけば attach は focus', () => {
    const [row] = buildRows(base({ jobs: [job({})], herdr: [herdr({ sessionId: 's-job1', paneId: 'w9:p1' })] }));
    expect(row?.attach).toEqual({ type: 'focus', paneId: 'w9:p1' });
  });
});

describe('Claude 対話セッション', () => {
  test('transcript と Herdr を合わせて行にする', () => {
    const [row] = buildRows(base({ sessions: [session({})], transcripts: new Map([['s-int', transcript({})]]), herdr: [herdr({})] }));
    expect(row).toMatchObject({
      key: 'claude:s-int', kind: 'interactive', status: 'working', statusSource: 'herdr',
      model: 'claude-fable-5-1',
      originalPrompt: '元の指示 int', latestPrompt: '進めて', activity: 'テスト中',
      location: { branch: 'feature/b', paneId: 'w1:p1' }, attach: { type: 'focus', paneId: 'w1:p1' }, updatedAt: 950,
    });
  });
  test('未回答の AskUserQuestion があれば Herdr より優先して blocked', () => {
    const [row] = buildRows(base({ sessions: [session({})], transcripts: new Map([['s-int', transcript({ pendingQuestion: '期間は？' })]]), herdr: [herdr({ status: 'working' })] }));
    expect(row?.status).toBe('blocked');
    expect(row?.statusSource).toBe('transcript');
    expect(row?.pending).toEqual({ kind: 'input needed', text: '期間は？' });
  });
  test('Herdr が blocked なら最後の発話を添えて pending にする', () => {
    const [row] = buildRows(base({ sessions: [session({})], transcripts: new Map([['s-int', transcript({})]]), herdr: [herdr({ status: 'blocked' })] }));
    expect(row?.pending).toEqual({ kind: 'herdr-blocked', text: 'テスト中' });
  });
  test('Herdr の done は stateChangeSeq を doneMarker にする', () => {
    const [row] = buildRows(base({ sessions: [session({})], herdr: [herdr({ status: 'done', stateChangeSeq: 77 })] }));
    expect(row?.status).toBe('done');
    expect(row?.doneMarker).toBe('77');
  });
  test('Herdr の done で stateChangeSeq が無ければ doneMarker は null のまま', () => {
    const [row] = buildRows(base({ sessions: [session({})], herdr: [herdr({ status: 'done', stateChangeSeq: null })] }));
    expect(row?.status).toBe('done');
    expect(row?.doneMarker).toBeNull();
  });
  test('Herdr が無ければ sessions の busy/idle を使い、attach は hint', () => {
    const [row] = buildRows(base({ sessions: [session({ status: 'idle' })] }));
    expect(row).toMatchObject({ status: 'idle', statusSource: 'session', attach: { type: 'hint', text: 'claude --resume s-int' } });
  });
  test('sessionId の無い Herdr pane は cwd が一意に一致するときだけ紐づく', () => {
    const [row] = buildRows(base({ sessions: [session({})], herdr: [herdr({ sessionId: null, paneId: 'w5:p1' })] }));
    expect(row?.location.paneId).toBe('w5:p1');
    const [row2] = buildRows(base({ sessions: [session({})], herdr: [herdr({ sessionId: null, paneId: 'w5:p1' }), herdr({ sessionId: null, paneId: 'w6:p1' })] }));
    expect(row2?.location.paneId).toBeNull();
  });
  test('同じ cwd に 2 つのセッションがあると、無紐付け pane が 1 つでもどちらにも紐づけない', () => {
    const rows = buildRows(base({
      sessions: [session({ sessionId: 's-int-1' }), session({ sessionId: 's-int-2' })],
      herdr: [herdr({ sessionId: null, paneId: 'w5:p1' })],
    }));
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.location.paneId).toBeNull();
      expect(row.attach).toEqual({ type: 'hint', text: `claude --resume ${row.key.replace('claude:', '')}` });
    }
  });
  test('doneMarker: updatedAt が無い done ジョブは null のまま（空文字の使い回しにしない）', () => {
    const [row] = buildRows(base({ jobs: [job({ state: 'done', updatedAt: null })] }));
    expect(row?.doneMarker).toBeNull();
  });
});

describe('Codex', () => {
  test('Herdr の codex pane だけが行になり、状態は Herdr、内容は rollout/history', () => {
    const rows = buildRows(base({ codex: [codex({})], herdr: [herdr({ agent: 'codex', sessionId: 'thread-1', paneId: 'w2:p1', status: 'idle', cwd: '/home/u/.herdr/worktrees/ws/x' })] }));
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({
      key: 'codex:thread-1', agent: 'codex', kind: 'interactive', name: '9月目標', status: 'idle', statusSource: 'herdr',
      model: 'gpt-5.6-sol',
      originalPrompt: '元の指示 codex', activity: '章立てを直した', location: { branch: 'worktree/x', paneId: 'w2:p1', display: '/home/u/.herdr/worktrees/ws/x' },
      attach: { type: 'focus', paneId: 'w2:p1' },
    });
  });
  test('Herdr に pane が無い thread は行にしない', () => {
    expect(buildRows(base({ codex: [codex({})] })).length).toBe(0);
  });
  test('Herdr の unknown は idle にして statusSource は herdr', () => {
    const [row] = buildRows(base({ codex: [codex({})], herdr: [herdr({ agent: 'codex', sessionId: 'thread-1', status: 'unknown' })] }));
    expect(row?.status).toBe('idle');
  });
});

describe('statusNote（Herdr 推定の由来を残す）', () => {
  test('Herdr の unknown は statusNote が判定不能になる（idle に丸められて事実と区別できなくなるため）', () => {
    const [row] = buildRows(base({ codex: [codex({})], herdr: [herdr({ agent: 'codex', sessionId: 'thread-1', status: 'unknown' })] }));
    expect(row?.statusNote).toBe('判定不能');
  });
  test('Herdr 由来の done は statusNote が Herdr 検知になる', () => {
    const [row] = buildRows(base({ sessions: [session({})], herdr: [herdr({ status: 'done', stateChangeSeq: 1 })] }));
    expect(row?.statusSource).toBe('herdr');
    expect(row?.statusNote).toBe('Herdr 検知');
  });
  test('job 由来の blocked は Herdr 推定ではないので statusNote は null', () => {
    const [row] = buildRows(base({ jobs: [job({ state: 'blocked' })] }));
    expect(row?.statusSource).toBe('job');
    expect(row?.statusNote).toBeNull();
  });
});

describe('displayName', () => {
  test('名前が無ければ元の指示の先頭 30 文字', () => {
    expect(displayName(null, 'あ'.repeat(40))).toBe('あ'.repeat(30));
    expect(displayName(null, null)).toBe('(no name)');
    expect(displayName('x', 'y')).toBe('x');
  });
});
