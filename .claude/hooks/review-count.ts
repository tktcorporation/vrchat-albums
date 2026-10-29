#!/usr/bin/env bun
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  currentBranch,
  gitCommonDir,
  headSha,
  projectDirectory,
  shasInReviewRange,
  workingTree,
} from './hook-utils.ts';
import { entriesWithin, entrySha, formatEntries, parseEntries, roundsOf } from './review-policy.ts';
import type { Entry, Round } from './review-policy.ts';
/**
 * レビュー記録はブランチごとに持つ。置き場所は対象チェックアウトの git 共通ディレクトリの下
 * なので、linked worktree から記録しても主チェックアウトと同じ場所になり、別ブランチの記録とは
 * ファイル名で分かれる。git が使えない場所では CLAUDE_PROJECT_DIR 配下に置く。
 *
 * 対象ブランチは常に作業ツリーの現在のブランチで決める。収束したら、記録用の CLI がその
 * HEAD の SHA を PR 作成ゲートの証跡として別の台帳に書く（pr-review-gate.ts）。
 *
 * 引数の `cwd` は対象チェックアウトのディレクトリ。hook は hook-utils.ts の resolveTarget で
 * 解いた対象を渡し、CLI は省略してプロセスの現在地を対象にする。サブモジュールの記録は
 * そのサブモジュールの git 共通ディレクトリ（`<superproject>/.git/modules/<name>`）の下に置かれる。
 *
 * 記録の鍵はブランチ名だけなので、マージ後に同じ名前でブランチを作り直すと、別の作業の
 * 記録が同じファイルに残る。収束と振り返りの判定には、レビュー範囲 `<default>...HEAD` に入る
 * コミット（HEAD から辿れて origin の default branch の先端からは辿れないもの）をレビューした
 * 記録だけを数える（readEntries、範囲の詳細は shasInReviewRange）。default branch に取り込まれた
 * コミットや、rebase・force-push で履歴から外れたコミットへの記録は、今の差分を見ていないため
 * 数えない。
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
/**
 * ファイルにある記録をすべて古い順に返す。レビュー範囲の外の記録も含む。
 * 外部指摘の履歴（.external）はこの並びの位置をラウンド数として保存するので、外部指摘の
 * 判定はこちらを使い、位置がずれないようにする。記録形式は review-policy.ts が定める。
 */
export async function readRecordedEntries(input?: { cwd?: string } | null): Promise<Entry[]> {
  const file = Bun.file(await reviewCountFile(input));
  return (await file.exists()) ? parseEntries(await file.text()) : [];
}
/**
 * 与えた SHA のうち、対象チェックアウトのレビュー範囲に入るもの。範囲を判定できないときは null
 * （呼び出し側は絞り込まない）。範囲の定義は hook-utils.ts の shasInReviewRange。
 */
export async function reviewRangeOf(
  shas: Iterable<string>,
  input?: { cwd?: string } | null,
): Promise<Set<string> | null> {
  return shasInReviewRange(await workingTree(input), shas);
}

/**
 * レビュー範囲に入るコミットをレビューした記録だけを、古い順に返す。収束と振り返りの判定に使う。
 * 範囲を判定できないときは絞り込まずにすべて返す。
 */
export async function readEntries(input?: { cwd?: string } | null): Promise<Entry[]> {
  const entries = await readRecordedEntries(input);
  if (entries.length === 0) return entries;
  const reachable = await reviewRangeOf(
    entries.map((entry) => entrySha(entry)),
    input,
  );
  return reachable === null ? entries : entriesWithin(entries, reachable);
}
/** レビュー範囲に入るラウンドを、古い順に返す。 */
export async function readRounds(input?: { cwd?: string } | null): Promise<Round[]> {
  return roundsOf(await readEntries(input));
}
/** ファイルにあるラウンドをすべて、古い順に返す。位置の意味は readRecordedEntries を参照。 */
export async function readRecordedRounds(input?: { cwd?: string } | null): Promise<Round[]> {
  return roundsOf(await readRecordedEntries(input));
}
/** ファイル全体を書き換える。辿れない記録も含めて、渡した記録だけが残る。 */
export async function writeEntries(
  entries: Entry[],
  input?: { cwd?: string } | null,
): Promise<void> {
  const file = await reviewCountFile(input);
  await mkdir(dirname(file), { recursive: true });
  await Bun.write(file, formatEntries(entries));
}
/**
 * 1 件を末尾に追記する。既存の行は書き換えないので、外部指摘の履歴が保存したラウンド数の
 * 位置がずれない。
 */
export async function appendEntry(entry: Entry, input?: { cwd?: string } | null): Promise<void> {
  const file = await reviewCountFile(input);
  await mkdir(dirname(file), { recursive: true });
  // 手で編集されて末尾の改行が無いファイルでも、前の行に連結しないようにする。
  const existing = Bun.file(file);
  const text = (await existing.exists()) ? await existing.text() : '';
  const separator = text === '' || text.endsWith('\n') ? '' : '\n';
  await appendFile(file, `${separator}${formatEntries([entry])}`);
}
/** レビュー対象になる HEAD の SHA。記録・判定の両方でこれを使う。 */
export async function reviewTargetSha(input?: { cwd?: string } | null): Promise<string> {
  return headSha(await workingTree(input));
}
