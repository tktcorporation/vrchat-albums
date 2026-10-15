import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultAckPath, isAcked, loadAcks, saveAcks, withAck } from '../src/model/ack';
import type { FleetRow } from '../src/model/row';

const row = (over: Partial<FleetRow>): FleetRow => ({
  key: 'claude-bg:job1', agent: 'claude', kind: 'background', name: 'n', model: null, status: 'done', statusSource: 'job',
  statusNote: null, originalPrompt: null, latestPrompt: null, activity: null, pending: null,
  location: { cwd: '/', display: '.', branch: null, paneId: null }, artifacts: [], startedAt: null, updatedAt: null,
  doneMarker: '3000', attach: { type: 'claude-attach', jobId: 'job1' }, ...over,
});

describe('ack', () => {
  test('marker が一致するときだけ確認済み', () => {
    const acks = withAck({}, row({}));
    expect(isAcked(acks, row({}))).toBe(true);
    expect(isAcked(acks, row({ doneMarker: '4000' }))).toBe(false);
    expect(isAcked(acks, row({ doneMarker: null }))).toBe(false);
  });

  test('ファイルに保存して読み戻せる。無ければ空', () => {
    const p = join(mkdtempSync(join(tmpdir(), 'ack-')), 'nested', 'ack.json');
    const missing = loadAcks(p);
    expect(missing.ok).toBe(true);
    expect(missing.ok ? missing.value : null).toEqual({});

    const saved = saveAcks(p, { 'claude-bg:job1': '3000' });
    expect(saved.ok).toBe(true);

    const reloaded = loadAcks(p);
    expect(reloaded.ok).toBe(true);
    expect(reloaded.ok ? reloaded.value : null).toEqual({ 'claude-bg:job1': '3000' });
  });

  test('壊れた JSON は fail(parse_error) を返す', () => {
    const p = join(mkdtempSync(join(tmpdir(), 'ack-')), 'ack.json');
    writeFileSync(p, '{not valid json');
    const r = loadAcks(p);
    expect(r.ok).toBe(false);
    expect(r.ok ? null : r.error.type).toBe('parse_error');
  });

  test('ack ファイルの位置がディレクトリだと fail(io_error) を返し、not_found のように空扱いにしない', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ack-'));
    const r = loadAcks(dir);
    expect(r.ok).toBe(false);
    expect(r.ok ? null : r.error.type).toBe('io_error');
  });

  test('保存先の親が書き込めない場合、投げずに not_found を返す', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ack-'));
    const blocker = join(dir, 'blocker');
    writeFileSync(blocker, 'not a directory');
    // blocker はファイルなので、その配下へのパスは mkdirSync/writeFileSync が失敗する
    const p = join(blocker, 'ack.json');
    const r = saveAcks(p, { a: '1' });
    expect(r.ok).toBe(false);
    expect(r.ok ? null : r.error.type).toBe('not_found');
  });

  test('XDG_STATE_HOME: 空・空白・相対パスは無視して既定値へ、絶対パスは尊重する', () => {
    const original = process.env.XDG_STATE_HOME;
    try {
      process.env.XDG_STATE_HOME = '';
      expect(defaultAckPath()).not.toContain('undefined');
      expect(defaultAckPath().endsWith(join('.local', 'state', 'agent-fleet', 'ack.json'))).toBe(true);

      process.env.XDG_STATE_HOME = 'relative/dir';
      expect(defaultAckPath().endsWith(join('.local', 'state', 'agent-fleet', 'ack.json'))).toBe(true);

      process.env.XDG_STATE_HOME = '/abs/state';
      expect(defaultAckPath()).toBe('/abs/state/agent-fleet/ack.json');
    } finally {
      if (original === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = original;
    }
  });
});
