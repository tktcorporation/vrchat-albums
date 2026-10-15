import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { runCommand } from './exec';
import { fail, ok, type SourceResult } from './types';

export type WorktreeInfo = { path: string; branch: string | null; repoRoot: string };

export function parseWorktreePorcelain(text: string, repoRoot: string): WorktreeInfo[] {
  const out: WorktreeInfo[] = [];
  let cur: WorktreeInfo | null = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('worktree ')) {
      cur = { path: line.slice('worktree '.length), branch: null, repoRoot };
      out.push(cur);
    } else if (line.startsWith('branch ') && cur) {
      cur.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    }
  }
  return out;
}

// repo/ 配下は git submodule の集まりで、各サブモジュールが自分の worktree 一覧を持つため
// root と別々に収集する。repo/ 自体や個々のエントリが読めない（存在しない・通常ファイル・
// パーミッション無し等）状態は珍しくない。readdirSync と statSync/existsSync を呼び出しごとに
// 別々に try-catch するのは、壊れた 1 サブモジュール（読めない・消えた等）のせいで
// root の worktree 一覧まで巻き添えで欠落させないため。
function listSubmoduleRoots(repoDir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(repoDir);
  } catch {
    return [];
  }
  const roots: string[] = [];
  for (const name of entries) {
    const p = join(repoDir, name);
    try {
      if (!statSync(p).isDirectory()) continue;
      if (existsSync(join(p, '.git'))) roots.push(p);
    } catch {
      // 列挙後に消えた・権限が無い等は、そのエントリだけ無視する
    }
  }
  return roots;
}

// root と各サブモジュールで git worktree list を独立に実行する。root が失敗しても
// サブモジュールのどれかが取れれば部分データを返す（無いよりまし）。全滅したときだけ
// 呼び出し元にエラーとして伝える。伝えるエラーは root のものを使う（サブモジュールが
// 存在しない環境では root の失敗だけが起きうるため、最も代表的な失敗理由になる）。
//
// submoduleDir はワークスペース直下のサブモジュール置き場のディレクトリ名。他リポジトリでは
// サブモジュールを別名で置く、あるいはサブモジュール自体を持たないことがあるため既定値
// ('repo') から変えられるようにしている。指定したディレクトリが存在しない場合は
// listSubmoduleRoots が空配列を返すだけで、root の収集には影響しない。
export async function collectWorktrees(
  workspaceRoot: string,
  run: typeof runCommand = runCommand,
  submoduleDir = 'repo',
): Promise<SourceResult<WorktreeInfo[]>> {
  const submoduleRoots = listSubmoduleRoots(join(workspaceRoot, submoduleDir));

  const rootResult = await run(['git', '-C', workspaceRoot, 'worktree', 'list', '--porcelain'], 5000);
  const all: WorktreeInfo[] = [];
  let anySucceeded = false;
  if (rootResult.ok) {
    all.push(...parseWorktreePorcelain(rootResult.value, workspaceRoot));
    anySucceeded = true;
  }

  for (const root of submoduleRoots) {
    const r = await run(['git', '-C', root, 'worktree', 'list', '--porcelain'], 5000);
    if (r.ok) {
      all.push(...parseWorktreePorcelain(r.value, root));
      anySucceeded = true;
    }
  }

  if (!anySucceeded && !rootResult.ok) return fail(rootResult.error.type, rootResult.error.detail);
  return ok(all);
}

export function branchForCwd(worktrees: WorktreeInfo[], cwd: string): WorktreeInfo | null {
  let best: WorktreeInfo | null = null;
  for (const w of worktrees) {
    const isUnder = cwd === w.path || cwd.startsWith(w.path.endsWith(sep) ? w.path : w.path + sep);
    if (isUnder && (!best || w.path.length > best.path.length)) best = w;
  }
  return best;
}

export function relativeLocation(workspaceRoot: string, cwd: string): string {
  const rel = relative(workspaceRoot, cwd);
  if (rel === '') return '.';
  // '..' そのもの、または '../' で始まる場合だけが「配下から外れた」相対パス。
  // 単純な `startsWith('..')` だと `..cache` のような、たまたま '..' で始まる
  // ワークスペース配下のディレクトリ名まで「外」と誤判定してしまう。
  const isOutside = rel === '..' || rel.startsWith('..' + sep);
  return isOutside ? cwd : rel;
}
