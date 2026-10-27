/// <reference types="bun" />
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Codex の hook コマンドが `.codex/run-shared-hook.ts` を探す基準のディレクトリを求める部分。
// 生成器が書き出した .codex/hooks.json の実際の文字列から取り出し、その文字列そのものを動かす。
const hooksJson: { hooks: Record<string, { hooks: { command: string }[] }[]> } = JSON.parse(
  readFileSync(join(import.meta.dir, '../../.codex/hooks.json'), 'utf8'),
);
const firstCommand = Object.values(hooksJson.hooks)[0]?.[0]?.hooks[0]?.command ?? '';
const rootSnippet = firstCommand.slice('bun "'.length, firstCommand.indexOf('/.codex/'));

function git(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync(
    ['git', '-c', 'commit.gpgsign=false', '-c', 'protocol.file.allow=always', ...args],
    {
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
      },
    },
  );
  if (result.exitCode !== 0)
    throw new Error(`git ${args.join(' ')}: ${new TextDecoder().decode(result.stderr)}`);
}

function resolveRoot(cwd: string): string {
  const result = Bun.spawnSync(['sh', '-c', `printf %s "${rootSnippet}"`], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return new TextDecoder().decode(result.stdout);
}

let base = '';
let at: { outer: string; sub: string; subWorktree: string; outerWorktree: string };

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'codex-root-')));
  at = {
    outer: join(base, 'outer'),
    sub: join(base, 'outer', 'lib'),
    subWorktree: join(base, 'lib-worktree'),
    outerWorktree: join(base, 'outer-worktree'),
  };
  const library = join(base, 'library');
  git(base, 'init', '-q', library);
  git(library, 'commit', '-q', '--allow-empty', '-m', 'library');
  git(base, 'init', '-q', at.outer);
  git(at.outer, 'commit', '-q', '--allow-empty', '-m', 'outer');
  git(at.outer, 'submodule', 'add', '-q', library, 'lib');
  git(at.outer, 'commit', '-q', '-m', 'add submodule');
  git(at.sub, 'worktree', 'add', '-q', '-b', 'lib-work', at.subWorktree);
  git(at.outer, 'worktree', 'add', '-q', '-b', 'outer-work', at.outerWorktree);
});

afterAll(() => {
  if (base) rmSync(base, { recursive: true, force: true });
});

describe('Codex の hook コマンドがいちばん外側のリポジトリを求める部分', () => {
  test('生成された hooks.json から取り出した部分は、コマンド置換の形をしている', () => {
    expect(rootSnippet.startsWith('$(')).toBe(true);
    expect(rootSnippet.endsWith(')')).toBe(true);
  });

  test('外側のリポジトリ・サブモジュール・サブモジュールの linked worktree からは外側のリポジトリを、外側の linked worktree からはその worktree を返す', () => {
    expect(resolveRoot(at.outer)).toBe(at.outer);
    expect(resolveRoot(at.sub)).toBe(at.outer);
    expect(resolveRoot(at.subWorktree)).toBe(at.outer);
    expect(resolveRoot(at.outerWorktree)).toBe(at.outerWorktree);
  });
});
