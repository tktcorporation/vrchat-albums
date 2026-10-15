import { describe, expect, test } from 'bun:test';
import { renderOnce, workspaceRootFrom } from '../src/cli';
import type { AckStore } from '../src/model/ack';
import type { FleetRow, Snapshot } from '../src/model/row';
import { textWidth } from '../src/tui/format';

describe('workspaceRootFrom', () => {
  test('%20 でエンコードされた空白を含む file URL を実パスへ戻す', () => {
    expect(workspaceRootFrom('file:///workspaces/my%20workspace/tools/agent-fleet/src/cli.tsx')).toBe(
      '/workspaces/my workspace',
    );
  });
});

const now = 10_000_000_000;
const row = (over: Partial<FleetRow>): FleetRow => ({
  key: 'k',
  agent: 'claude',
  kind: 'interactive',
  name: 'a session name',
  model: null,
  status: 'working',
  statusSource: 'herdr',
  statusNote: null,
  originalPrompt: null,
  latestPrompt: null,
  activity: '作業中の説明',
  pending: null,
  location: { cwd: '/w', display: '.claude/worktrees/x', branch: 'feat/x', paneId: 'w1:p1' },
  artifacts: [],
  startedAt: now - 60_000,
  updatedAt: now - 5_000,
  doneMarker: null,
  attach: { type: 'focus', paneId: 'w1:p1' },
  ...over,
});
const snapshot = (rows: FleetRow[]): Snapshot => ({
  rows,
  sources: { herdr: null, claudeAgents: null, claudeJobs: null, claudeSessions: null, codex: null, worktrees: null, transcripts: null },
  collectedAt: now,
});
const acks: AckStore = {};

describe('renderOnce', () => {
  test('1セッションは行1・行2の2行で出る（--once も TUI と同じ row-lines 形式）', () => {
    const output = renderOnce(snapshot([row({})]), acks, now);
    const lines = output.split('\n');
    // 見出し行(要対応 (n) 等)を挟んで、1セッションぶんが必ず2行で連続する。
    const sessionLines = lines.filter((l) => !l.match(/^(要対応|作業中|待機|その他) \(\d+\)$/));
    expect(sessionLines).toHaveLength(2);
    expect(sessionLines[0]).toContain('a session name');
    expect(sessionLines[1]).toContain('作業中の説明');
  });

  test('width 引数は行1の表示幅に効く（buildLine1 と同じ幅の式を通る）', () => {
    const narrow = renderOnce(snapshot([row({})]), acks, now, null, 40);
    const wide = renderOnce(snapshot([row({})]), acks, now, null, 120);
    const line1Of = (output: string) => output.split('\n').find((l) => l.includes('a session name')) ?? '';
    expect(textWidth(line1Of(narrow))).toBeLessThanOrEqual(39);
    expect(textWidth(line1Of(wide))).toBe(119);
    expect(textWidth(line1Of(narrow))).toBeLessThan(textWidth(line1Of(wide)));
  });

  test('源エラーと ack エラーは末尾にまとめて出る', () => {
    const s: Snapshot = {
      ...snapshot([row({})]),
      sources: { herdr: { type: 'not_running', detail: 'herdr missing' }, claudeAgents: null, claudeJobs: null, claudeSessions: null, codex: null, worktrees: null, transcripts: null },
    };
    const output = renderOnce(s, acks, now, { type: 'io_error', detail: 'ack unreadable' });
    const lines = output.split('\n');
    expect(lines[lines.length - 2]).toBe('herdr: herdr missing');
    expect(lines[lines.length - 1]).toBe('ack: ack unreadable');
  });
});
