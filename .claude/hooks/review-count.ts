#!/usr/bin/env bun
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  currentBranch,
  gitCommonDir,
  headSha,
  projectDirectory,
  workingTree,
} from './hook-utils.ts';
import { formatEntries, parseEntries, roundsOf } from './review-policy.ts';
import type { Entry, Round } from './review-policy.ts';
/**
 * レビュー記録はブランチごとに持つ。置き場所は主チェックアウトの .git 配下なので、linked
 * worktree から記録しても hook と同じファイルになり、別ブランチの記録とは混ざらない。git が
 * 使えない場所では CLAUDE_PROJECT_DIR 配下に置く。
 *
 * 対象ブランチは常に作業ツリーの現在のブランチで決める。`gh pr create --head <branch>`
 * で別ブランチを指定する場合は、そのブランチのディレクトリ（worktree）から記録・作成する
 * こと。コマンド文字列から --head を正規表現で拾う実装は、--title/--body の自由記述に
 * 同じ文字列が現れるとゲートを誤って通してしまうため採用しない。
 */
export async function reviewCountFile(input?: { cwd?: string } | null): Promise<string> {
  const tree = await workingTree(input);
  // encodeURIComponent は `/` を %2F にするなど可逆に符号化するので、feature/foo と
  // feature_foo が同じファイルを指すことがない。
  const branch = encodeURIComponent(await currentBranch(tree));
  const common = await gitCommonDir(tree);
  const base = common
    ? join(common, 'claude', 'pr-review')
    : join(await projectDirectory(), '.claude', 'pr-review');
  return join(base, `${branch}.rounds`);
}
/** PR 作成後、外部から指摘を受けた HEAD とユーザー判断の記録。 */
export async function externalReviewFile(input?: { cwd?: string } | null): Promise<string> {
  return `${await reviewCountFile(input)}.external`;
}
/** 記録を古い順に返す。記録形式は review-policy.ts が定める。 */
export async function readEntries(input?: { cwd?: string } | null): Promise<Entry[]> {
  const file = Bun.file(await reviewCountFile(input));
  return (await file.exists()) ? parseEntries(await file.text()) : [];
}
/** 記録済みラウンドを、古い順に返す。 */
export async function readRounds(input?: { cwd?: string } | null): Promise<Round[]> {
  return roundsOf(await readEntries(input));
}
export async function writeEntries(
  entries: Entry[],
  input?: { cwd?: string } | null,
): Promise<void> {
  const file = await reviewCountFile(input);
  await mkdir(dirname(file), { recursive: true });
  await Bun.write(file, formatEntries(entries));
}
/** レビュー対象になる HEAD の SHA。記録・判定の両方でこれを使う。 */
export async function reviewTargetSha(input?: { cwd?: string } | null): Promise<string> {
  return headSha(await workingTree(input));
}
