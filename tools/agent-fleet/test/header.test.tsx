import { describe, expect, test } from 'bun:test';
import { render } from 'ink-testing-library';
import React from 'react';
import type { Groups } from '../src/model/group';
import type { Snapshot } from '../src/model/row';
import { Header } from '../src/tui/Header';
import { textWidth } from '../src/tui/format';

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

const groups: Groups = { pending: [1, 2] as never, working: [1] as never, idle: [], other: [] };
const now = 10_000_000_000;
const snapshot: Snapshot = { rows: [], sources: {} as never, collectedAt: now - 3_000 };

describe('Header', () => {
  test.each([50, 40])('幅%iでもヘッダ行の表示幅は width - 1 以下になる', (width) => {
    const { lastFrame } = render(<Header groups={groups} snapshot={snapshot} now={now} width={width} />);
    const frame = stripAnsi(lastFrame() ?? '');
    expect(textWidth(frame)).toBeLessThanOrEqual(width - 1);
  });

  test('通常幅では0件グループが省かれ、件数と更新時刻がヘッダに出る', () => {
    const { lastFrame } = render(<Header groups={groups} snapshot={snapshot} now={now} width={100} />);
    const frame = stripAnsi(lastFrame() ?? '');
    expect(frame).toContain('要対応 2');
    expect(frame).toContain('作業中 1');
    expect(frame).not.toContain('待機');
    expect(frame).not.toContain('その他');
    expect(frame).toContain('更新 3s 前');
  });
});
