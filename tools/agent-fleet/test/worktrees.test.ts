import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fail, ok } from '../src/collect/types';
import { branchForCwd, collectWorktrees, parseWorktreePorcelain, relativeLocation } from '../src/collect/worktrees';

const text = await Bun.file(join(import.meta.dir, 'fixtures', 'worktree-porcelain.txt')).text();

describe('parseWorktreePorcelain', () => {
  test('path と branch を取り、detached は branch null', () => {
    const w = parseWorktreePorcelain(text, '/workspaces/ws');
    expect(w).toEqual([
      { path: '/workspaces/ws', branch: 'main', repoRoot: '/workspaces/ws' },
      { path: '/workspaces/ws/.claude/worktrees/feature-b', branch: 'feature/b', repoRoot: '/workspaces/ws' },
      { path: '/workspaces/ws/.claude/worktrees/detached-one', branch: null, repoRoot: '/workspaces/ws' },
    ]);
  });
});

describe('branchForCwd', () => {
  const w = parseWorktreePorcelain(text, '/workspaces/ws');
  test('最も長く一致する worktree を選ぶ', () => {
    expect(branchForCwd(w, '/workspaces/ws/.claude/worktrees/feature-b/tools/x')?.branch).toBe('feature/b');
    expect(branchForCwd(w, '/workspaces/ws/redash')?.branch).toBe('main');
  });
  test('前方一致は path 区切りで判定する', () => {
    expect(branchForCwd(w, '/workspaces/ws2/x')).toBeNull();
  });
});

describe('relativeLocation', () => {
  test('ワークスペース配下は相対パス、外は絶対パス', () => {
    expect(relativeLocation('/workspaces/ws', '/workspaces/ws/.claude/worktrees/feature-b')).toBe(
      '.claude/worktrees/feature-b',
    );
    expect(relativeLocation('/workspaces/ws', '/workspaces/ws')).toBe('.');
    expect(relativeLocation('/workspaces/ws', '/home/u/.herdr/worktrees/ws/x')).toBe('/home/u/.herdr/worktrees/ws/x');
  });

  test('".." で始まるが実際は配下のディレクトリ名（..cache 等）を外と誤判定しない', () => {
    expect(relativeLocation('/workspaces/ws', '/workspaces/ws/..cache/x')).toBe('..cache/x');
  });
});

describe('collectWorktrees', () => {
  test('root と repo/* それぞれの出力を、repoRoot を保ったまま連結する', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-fleet-worktrees-aggregate-'));
    try {
      const subRoot = join(dir, 'repo', 'x');
      mkdirSync(join(subRoot, '.git'), { recursive: true });

      // root とサブモジュールで異なる porcelain 出力を返し、単なる「呼ばれた回数」ではなく
      // 実際に -C で渡した root ごとの出力が正しく repoRoot 付きで積まれているかを検証する。
      const subText = ['worktree ' + subRoot, 'HEAD ' + '1'.repeat(40), 'branch refs/heads/sub/x', ''].join('\n');

      const calls: string[][] = [];
      const r = await collectWorktrees(dir, async (cmd) => {
        calls.push(cmd);
        if (cmd[2] === subRoot) return ok(subText);
        return ok(text);
      });
      if (!r.ok) throw new Error(`expected ok, got error: ${r.error.type} ${r.error.detail}`);

      expect(calls[0]).toEqual(['git', '-C', dir, 'worktree', 'list', '--porcelain']);
      // root 分のパスはフィクスチャの porcelain 出力そのままの文字列（/workspaces/ws/...）で、
      // repoRoot だけが実際に -C で渡した一時ディレクトリ (dir) になる。
      expect(r.value).toEqual([
        { path: '/workspaces/ws', branch: 'main', repoRoot: dir },
        { path: '/workspaces/ws/.claude/worktrees/feature-b', branch: 'feature/b', repoRoot: dir },
        { path: '/workspaces/ws/.claude/worktrees/detached-one', branch: null, repoRoot: dir },
        { path: subRoot, branch: 'sub/x', repoRoot: subRoot },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('root と、.git を持つ各 repo/* サブモジュールで git を呼ぶ（それ以外の repo/* エントリは無視）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-fleet-worktrees-'));
    try {
      const repoDir = join(dir, 'repo');
      mkdirSync(join(repoDir, 'lapras', '.git'), { recursive: true });
      mkdirSync(join(repoDir, 'not-a-repo'), { recursive: true });
      writeFileSync(join(repoDir, 'scouty'), 'not a directory'); // 不正なエントリ（ディレクトリではない）

      const calls: string[][] = [];
      const r = await collectWorktrees(dir, async (cmd) => {
        calls.push(cmd);
        return ok(text);
      });
      if (!r.ok) throw new Error(`expected ok, got error: ${r.error.type} ${r.error.detail}`);

      expect(calls).toContainEqual(['git', '-C', dir, 'worktree', 'list', '--porcelain']);
      expect(calls).toContainEqual(['git', '-C', join(repoDir, 'lapras'), 'worktree', 'list', '--porcelain']);
      expect(calls.length).toBe(2); // not-a-repo（.git 無し）と scouty（ディレクトリでない）は呼ばれない
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('repo が通常ファイルでも例外を投げず、root の worktree だけ返す', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-fleet-worktrees-repofile-'));
    try {
      writeFileSync(join(dir, 'repo'), 'this is a file, not a directory');

      const calls: string[][] = [];
      const r = await collectWorktrees(dir, async (cmd) => {
        calls.push(cmd);
        return ok(text);
      });
      if (!r.ok) throw new Error(`expected ok, got error: ${r.error.type} ${r.error.detail}`);
      expect(calls.length).toBe(1);
      expect(calls[0]).toEqual(['git', '-C', dir, 'worktree', 'list', '--porcelain']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('サブモジュール側の git 呼び出しが失敗しても root の結果は返す', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-fleet-worktrees-partial-'));
    try {
      mkdirSync(join(dir, 'repo', 'broken', '.git'), { recursive: true });

      const r = await collectWorktrees(dir, async (cmd) => {
        if (cmd.some((c) => c.includes('broken'))) return fail('not_running', 'git not found');
        return ok(text);
      });
      if (!r.ok) throw new Error(`expected ok, got error: ${r.error.type} ${r.error.detail}`);
      expect(r.value.length).toBe(3); // root 分のみ（broken は失敗して無視される）
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('root が失敗し、成功したサブモジュールが無ければ root のエラーを返す', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-fleet-worktrees-allfail-'));
    try {
      const r = await collectWorktrees(dir, async () => fail('not_running', 'git not found'));
      if (r.ok) throw new Error('should fail');
      expect(r.error).toEqual({ type: 'not_running', detail: 'git not found' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('root が失敗してもサブモジュールが成功すれば、その分だけ ok で返す', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-fleet-worktrees-rootfail-'));
    try {
      const subRoot = join(dir, 'repo', 'x');
      mkdirSync(join(subRoot, '.git'), { recursive: true });
      const subText = ['worktree ' + subRoot, 'HEAD ' + '2'.repeat(40), 'branch refs/heads/sub/x', ''].join('\n');

      const r = await collectWorktrees(dir, async (cmd) => {
        if (cmd[2] === dir) return fail('not_running', 'git not found');
        return ok(subText);
      });
      if (!r.ok) throw new Error(`expected ok, got error: ${r.error.type} ${r.error.detail}`);
      expect(r.value).toEqual([{ path: subRoot, branch: 'sub/x', repoRoot: subRoot }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('submoduleDir を指定すると、そのディレクトリ配下を対象にする', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-fleet-worktrees-customdir-'));
    try {
      const subRoot = join(dir, 'vendor', 'x');
      mkdirSync(join(subRoot, '.git'), { recursive: true });
      // 既定の 'repo' も併置し、submoduleDir 指定時には見に行かないことを確認する。
      mkdirSync(join(dir, 'repo', 'ignored', '.git'), { recursive: true });
      const subText = ['worktree ' + subRoot, 'HEAD ' + '3'.repeat(40), 'branch refs/heads/sub/x', ''].join('\n');

      const calls: string[][] = [];
      const r = await collectWorktrees(
        dir,
        async (cmd) => {
          calls.push(cmd);
          if (cmd[2] === subRoot) return ok(subText);
          return ok(text);
        },
        'vendor',
      );
      if (!r.ok) throw new Error(`expected ok, got error: ${r.error.type} ${r.error.detail}`);

      expect(calls).toContainEqual(['git', '-C', subRoot, 'worktree', 'list', '--porcelain']);
      expect(calls).not.toContainEqual(['git', '-C', join(dir, 'repo', 'ignored'), 'worktree', 'list', '--porcelain']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
