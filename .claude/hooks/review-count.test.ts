import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendEntry,
  readEntries,
  readRecordedEntries,
  readRounds,
  reviewCountFile,
  reviewTargetSha,
  writeEntries,
} from './review-count.ts';
import type { Entry } from './review-policy.ts';

const cleanups: string[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  cleanups.push(path);
  return path;
}

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(['git', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
  return new TextDecoder().decode(result.stdout).trim();
}

async function commit(cwd: string, content: string): Promise<string> {
  await writeFile(join(cwd, 'file'), content);
  git(cwd, 'add', 'file');
  git(cwd, 'commit', '-qm', content);
  return git(cwd, 'rev-parse', 'HEAD');
}

async function repo(): Promise<string> {
  const cwd = await tempDir('review-count-');
  git(cwd, 'init', '-q', '-b', 'work');
  git(cwd, 'config', 'user.name', 'Test');
  git(cwd, 'config', 'user.email', 'test@example.com');
  return cwd;
}

const round = (sha: string, count = 0): Entry => ({
  kind: 'round',
  round: { count, sha, reviewer: 'other', accepted: false },
});
const checkpoint = (sha: string): Entry => ({
  kind: 'checkpoint',
  decision: 'continue',
  sha,
  note: 'note',
});

describe('origin/HEAD が無いときは、現在の HEAD から辿れる記録だけを数える', () => {
  test('HEAD とその祖先への記録は数える', async () => {
    const cwd = await repo();
    const base = await commit(cwd, 'base');
    const head = await commit(cwd, 'head');
    const entries = [round(base, 2), checkpoint(base), round(head)];
    await writeEntries(entries, { cwd });
    expect(await readEntries({ cwd })).toEqual(entries);
  });

  test('同じ名前で作り直したブランチでは、前の作業の記録を数えない', async () => {
    const cwd = await repo();
    const base = await commit(cwd, 'base');
    const previous = await commit(cwd, 'previous work');
    // squash merge 後に default branch から同じ名前でブランチを作り直した状態
    git(cwd, 'reset', '-q', '--hard', base);
    const fresh = await commit(cwd, 'fresh work');
    await writeEntries([round(previous, 5), checkpoint(previous), round(fresh, 1)], { cwd });
    expect(await readEntries({ cwd })).toEqual([round(fresh, 1)]);
    expect((await readRounds({ cwd })).map((r) => r.sha)).toEqual([fresh]);
  });

  test('リポジトリが知らない SHA への記録は数えない', async () => {
    const cwd = await repo();
    const head = await commit(cwd, 'head');
    const unknown = 'a'.repeat(40);
    await writeEntries([round(unknown, 3), round(head)], { cwd });
    expect(await readEntries({ cwd })).toEqual([round(head)]);
  });

  test('追記は辿れない記録を消さない', async () => {
    const cwd = await repo();
    const base = await commit(cwd, 'base');
    const previous = await commit(cwd, 'previous work');
    git(cwd, 'reset', '-q', '--hard', base);
    const fresh = await commit(cwd, 'fresh work');
    await writeEntries([round(previous, 5)], { cwd });
    await appendEntry(round(fresh), { cwd });
    expect(await readRecordedEntries({ cwd })).toEqual([round(previous, 5), round(fresh)]);
    expect(await readEntries({ cwd })).toEqual([round(fresh)]);
  });

  test('末尾に改行の無いファイルへ追記しても前の行に連結しない', async () => {
    const cwd = await repo();
    const head = await commit(cwd, 'head');
    await Bun.write(await reviewCountFile({ cwd }), `3 ${head}`);
    await appendEntry(round(head), { cwd });
    expect(await readEntries({ cwd })).toEqual([round(head, 3), round(head)]);
  });

  test('git が使えない場所では絞り込まずにすべて数える', async () => {
    const cwd = await tempDir('review-count-nogit-');
    const previous = process.env.CLAUDE_PROJECT_DIR;
    process.env.CLAUDE_PROJECT_DIR = cwd;
    try {
      expect(await reviewTargetSha({ cwd })).toBe('unknown');
      const entries = [round('b'.repeat(40), 2), checkpoint('c'.repeat(40))];
      await writeEntries(entries, { cwd });
      expect((await reviewCountFile({ cwd })).startsWith(cwd)).toBe(true);
      expect(await readEntries({ cwd })).toEqual(entries);
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_PROJECT_DIR;
      else process.env.CLAUDE_PROJECT_DIR = previous;
    }
  });
});

/** bare のリモートと、origin/HEAD を main に向けたクローン。 */
async function cloned(): Promise<string> {
  const root = await tempDir('review-range-');
  const remote = join(root, 'remote.git');
  git(root, 'init', '-q', '--bare', '-b', 'main', remote);
  const cwd = join(root, 'clone');
  git(root, 'clone', '-q', remote, cwd);
  git(cwd, 'config', 'user.name', 'Test');
  git(cwd, 'config', 'user.email', 'test@example.com');
  git(cwd, 'checkout', '-q', '-b', 'main');
  await commit(cwd, 'base');
  git(cwd, 'push', '-q', 'origin', 'main');
  git(cwd, 'remote', 'set-head', 'origin', 'main');
  return cwd;
}

/** work ブランチで 1 コミット作り、指定の方法で main に取り込んで push し、同じ名前で作り直す。 */
async function mergeAndRecreate(cwd: string, how: '--no-ff' | '--ff-only'): Promise<string> {
  git(cwd, 'checkout', '-q', '-b', 'work');
  const previous = await commit(cwd, 'previous work');
  git(cwd, 'checkout', '-q', 'main');
  git(cwd, 'merge', '-q', how, '-m', 'merge work', 'work');
  git(cwd, 'push', '-q', 'origin', 'main');
  git(cwd, 'checkout', '-q', '-B', 'work', 'origin/main');
  return previous;
}

describe('レビュー範囲 <default>...HEAD に入る記録だけを数える', () => {
  test('merge commit で取り込まれた前の作業の記録は、作り直したブランチで数えない', async () => {
    const cwd = await cloned();
    const previous = await mergeAndRecreate(cwd, '--no-ff');
    const fresh = await commit(cwd, 'fresh work');
    // 前の作業のコミットは今の HEAD の祖先でもある。
    git(cwd, 'merge-base', '--is-ancestor', previous, 'HEAD');
    await writeEntries([round(previous, 5), checkpoint(previous), round(fresh, 1)], { cwd });
    expect(await readEntries({ cwd })).toEqual([round(fresh, 1)]);
  });

  test('fast-forward で取り込まれた前の作業の記録も数えない', async () => {
    const cwd = await cloned();
    const previous = await mergeAndRecreate(cwd, '--ff-only');
    const fresh = await commit(cwd, 'fresh work');
    await writeEntries([round(previous, 5), round(fresh, 1)], { cwd });
    expect((await readRounds({ cwd })).map((r) => r.sha)).toEqual([fresh]);
  });

  test('新しいコミットの無いブランチでは、default branch の先端への記録も含めて何も数えない', async () => {
    const cwd = await cloned();
    const previous = await mergeAndRecreate(cwd, '--ff-only');
    const tip = git(cwd, 'rev-parse', 'HEAD');
    expect(tip).toBe(previous);
    await writeEntries([round(tip, 0), checkpoint(tip)], { cwd });
    expect(await readEntries({ cwd })).toEqual([]);
  });

  test('default branch が先へ進んでも、分岐後のこのブランチのコミットは数える', async () => {
    const cwd = await cloned();
    git(cwd, 'checkout', '-q', '-b', 'work');
    const mine = await commit(cwd, 'mine');
    git(cwd, 'checkout', '-q', 'main');
    await commit(cwd, 'someone else');
    git(cwd, 'push', '-q', 'origin', 'main');
    git(cwd, 'checkout', '-q', 'work');
    await writeEntries([round(mine, 1)], { cwd });
    expect(await readEntries({ cwd })).toEqual([round(mine, 1)]);
  });

  test('origin/HEAD が解決できないときは HEAD から辿れるかだけで絞る', async () => {
    const cwd = await cloned();
    const previous = await mergeAndRecreate(cwd, '--ff-only');
    git(cwd, 'remote', 'set-head', 'origin', '--delete');
    const fresh = await commit(cwd, 'fresh work');
    await writeEntries([round(previous, 5), round(fresh, 1)], { cwd });
    expect(await readEntries({ cwd })).toEqual([round(previous, 5), round(fresh, 1)]);
  });
});
