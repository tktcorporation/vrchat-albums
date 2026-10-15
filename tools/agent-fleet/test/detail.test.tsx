import { describe, expect, test } from 'bun:test';
import { render } from 'ink-testing-library';
import React from 'react';
import type { FleetRow } from '../src/model/row';
import { Detail } from '../src/tui/Detail';

const row = (over: Partial<FleetRow>): FleetRow => ({
  key: 'k',
  agent: 'claude',
  kind: 'interactive',
  name: 'name',
  model: null,
  status: 'blocked',
  statusSource: 'herdr',
  statusNote: null,
  originalPrompt: '元の指示 '.repeat(80).trim(),
  latestPrompt: '最新の指示 '.repeat(80).trim(),
  activity: 'いま '.repeat(80).trim(),
  pending: { kind: 'input needed', text: '要判断 '.repeat(80).trim() },
  location: { cwd: '/w', display: '.claude/worktrees/x', branch: null, paneId: null },
  artifacts: [{ kind: 'pr', id: '1', href: 'https://example.test/pull/1' }],
  startedAt: null,
  updatedAt: null,
  doneMarker: null,
  attach: { type: 'hint', text: '移動 '.repeat(80).trim() },
  ...over,
});

describe('Detail', () => {
  test('maxLines 内なら全フィールドが出る', () => {
    const { lastFrame } = render(<Detail row={row({ model: 'claude-fable-5-1' })} width={80} maxLines={13} />);
    const frame = lastFrame() ?? '';
    for (const label of ['元の指示', '最新の指示', 'いま', 'モデル', '要判断', '場所', '成果物', '移動']) {
      expect(frame).toContain(label);
    }
  });

  test('非保護フィールドは末尾から落ち、保護フィールド（元の指示・要判断）は残る', () => {
    const { lastFrame } = render(<Detail row={row({})} width={80} maxLines={8} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('元の指示');
    expect(frame).toContain('要判断');
    // 末尾の非保護フィールドから間引かれるので、最後尾の「移動」は残らない。
    expect(frame).not.toContain('移動');
  });

  test('保護フィールドだけの合計が maxLines を超えても、要判断は行単位で切り詰められて残る', () => {
    const { lastFrame } = render(<Detail row={row({ model: null })} width={80} maxLines={3} />);
    const frame = lastFrame() ?? '';
    // 保護フィールド（元の指示3行+要判断2行=5行）だけで maxLines(3) を超える。
    // フィールドごと消えるのではなく、行単位で間引かれてどちらも見出しは残る。
    expect(frame).toContain('元の指示');
    expect(frame).toContain('要判断');
    expect(frame).not.toContain('最新の指示');
    expect(frame).not.toContain('いま');
  });
});
