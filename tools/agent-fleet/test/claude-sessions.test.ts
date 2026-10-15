import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectClaudeSessions,
  isClaudeProcess,
  isClaudeSessionActive,
  isProcessAlive,
  parseClaudeSession,
} from '../src/collect/claude-sessions';

const fixtures = join(import.meta.dir, 'fixtures', 'claude-sessions');

describe('collectClaudeSessions', () => {
  test('生存している対話セッションだけを返す', async () => {
    const r = await collectClaudeSessions(fixtures, (session) => session.pid === 1001 || session.pid === 1002);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.map((s) => s.pid)).toEqual([1001]);
    const s = r.value[0]!;
    expect(s.sessionId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(s.status).toBe('busy');
    expect(s.cwd).toBe('/workspaces/ws/.claude/worktrees/feature-b');
    expect(s.updatedAt).toBe(1788582337975);
  });
  test('.key など json 以外のファイルは無視する', async () => {
    const r = await collectClaudeSessions(fixtures, () => true);
    if (!r.ok) throw new Error('should succeed');
    // fixtures には .json が3件（うち対話は1001, 1003）と、拡張子が .json でない
    // 9999.key（中身は有効な対話セッション JSON）が1件ある。拡張子で弾かれるので
    // 9999 は結果に出てはいけない。
    expect(r.value.map((s) => s.pid)).not.toContain(9999);
    expect(r.value.length).toBe(2);
  });
  test('無いディレクトリは not_found', async () => {
    const r = await collectClaudeSessions(join(fixtures, 'nope'));
    if (!r.ok) expect(r.error.type).toBe('not_found');
    else throw new Error('should fail');
  });
  describe('通常ファイルを渡した場合', () => {
    let dir: string;
    afterEach(() => {
      if (dir) rmSync(dir, { recursive: true, force: true });
    });
    test('ディレクトリではなく通常ファイルを渡すと not_found', async () => {
      dir = mkdtempSync(join(tmpdir(), 'claude-sessions-'));
      const notADir = join(dir, 'not-a-dir');
      writeFileSync(notADir, 'plain file');
      const r = await collectClaudeSessions(notADir);
      if (!r.ok) expect(r.error.type).toBe('not_found');
      else throw new Error('should fail');
    });
  });
});

describe('parseClaudeSession', () => {
  test('pid と sessionId と cwd が無ければ null', () => {
    expect(parseClaudeSession({ pid: 1 })).toBeNull();
  });
  test('未知の kind と status は unknown', () => {
    const s = parseClaudeSession({ pid: 1, sessionId: 'x', cwd: '/', kind: 'weird', status: 'odd' });
    expect(s?.kind).toBe('unknown');
    expect(s?.status).toBe('unknown');
  });
  test.each([0, -1, 1.5])('pid %p は不正な値なので null', (pid) => {
    expect(parseClaudeSession({ pid, sessionId: 'x', cwd: '/' })).toBeNull();
  });
});

describe('isProcessAlive', () => {
  test('自分自身は生きている', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });
  test('ありえない pid は死んでいる', () => {
    expect(isProcessAlive(2 ** 22 - 1)).toBe(false);
  });
});

describe('isClaudeProcess', () => {
  test('Claude ではない自プロセスはセッションとして扱わない', () => {
    expect(isClaudeProcess(process.pid)).toBe(false);
  });
});

describe('isClaudeSessionActive', () => {
  const session = {
    pid: 1001,
    procStart: '123',
    sessionId: 'session',
    kind: 'interactive' as const,
    name: null,
    status: 'busy' as const,
    cwd: '/',
    jobId: null,
    startedAt: null,
    updatedAt: null,
  };

  test('同じ Claude PID でも procStart が違えば stale session として除外する', () => {
    expect(isClaudeSessionActive(session, () => true, () => '456')).toBe(false);
  });

  test('procStart が一致する Claude プロセスだけを受け入れる', () => {
    expect(isClaudeSessionActive(session, () => true, () => '123')).toBe(true);
  });
});
