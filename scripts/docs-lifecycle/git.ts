/**
 * docs ライフサイクル lint が使う git 呼び出しの薄いラッパ。
 *
 * 判定ロジック（freshness / links / references）は git を知らない純関数に保ち、
 * ここだけが副作用を持つ。テストは純関数側で行い、この層はモックしない。
 */

/// <reference types="node" />

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { GIT_LOG_COMMIT_MARKER, parseGitLogFileDates } from './freshness.ts';
import { type DocReference, buildReferencePattern, parseGitGrepMatches } from './references.ts';

/** git の起動そのものが失敗した（git が無い・cwd が壊れている等）*/
export class GitInvocationError extends Error {
  constructor(args: readonly string[], options?: { cause?: unknown }) {
    super(`git ${args.join(' ')} の実行に失敗しました`, options);
    this.name = 'GitInvocationError';
  }
}

/** git は起動したが期待しない終了コードを返した */
export class GitCommandFailedError extends Error {
  constructor(args: readonly string[], status: number | null, stderr: string) {
    super(`git ${args.join(' ')} が exit ${status ?? 'null'} で失敗しました: ${stderr}`);
    this.name = 'GitCommandFailedError';
  }
}

interface GitResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runGit(args: readonly string[], cwd: string): GitResult {
  // core.quotePath は既定で有効で、非 ASCII を含むパスを `"docs/\350..."` のように
  // オクタルエスケープして返す。そのままキーにすると実パスと突き合わせできず、
  // 日本語ファイル名の doc が永久に「未コミット」と判定され鮮度チェックが効かない。
  //
  // maxBuffer: git log / git grep の出力は doc 数に比例して伸びるため既定の 1MB では足りない。
  const result = spawnSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw new GitInvocationError(args, { cause: result.error });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: (result.stderr ?? '').trim(),
  };
}

function requireGit(args: readonly string[], cwd: string): string {
  const result = runGit(args, cwd);
  if (result.status !== 0) {
    throw new GitCommandFailedError(args, result.status, result.stderr);
  }
  return result.stdout;
}

/**
 * 履歴が truncate された clone かどうか。
 *
 * shallow clone では最終コミット日時が実際より新しく見え、stale な doc を
 * 見逃す。黙って通すと検知が無効化されるため、呼び出し側はこれを見て中断する。
 */
export function isShallowRepository(cwd: string): boolean {
  return requireGit(['rev-parse', '--is-shallow-repository'], cwd).trim() === 'true';
}

/**
 * git が認識しているファイル（追跡済み + gitignore されていない未追跡）を列挙する。
 *
 * 未追跡を含めるのは、新規作成したまま未コミットの doc も lint 対象にするため。
 * 削除済みで index に残っているパスは実体が無いので除く。
 */
export function listRepoFiles(cwd: string): string[] {
  const stdout = requireGit(['ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd);
  return stdout
    .split('\0')
    .filter((path) => path.length > 0)
    .filter((path) => existsSync(join(cwd, path)));
}

/**
 * ローカルで変更中（staged / unstaged / 未追跡）のファイルを返す。
 *
 * これらを鮮度チェックから外すのは、doc を見直している最中に「最終コミットが古い」
 * と報告されるのを防ぐため。見直しをコミットすれば履歴側の日付が更新される。
 * CI の working tree はクリーンなので、この除外は CI では効かない。
 */
export function listLocallyModifiedFiles(cwd: string): Set<string> {
  const stdout = requireGit(['status', '--porcelain=v1', '-z', '--untracked-files=all'], cwd);
  const modified = new Set<string>();

  // porcelain -z は `XY <path>\0`（rename は `XY <new>\0<old>\0`）で並ぶ。
  // rename の旧パスはもう存在しないので、エントリ先頭のパスだけを見る。
  const entries = stdout.split('\0');
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.length < 4) continue;

    const status = entry.slice(0, 2);
    modified.add(entry.slice(3));
    if (status.includes('R') || status.includes('C')) index += 1;
  }

  return modified;
}

/** pathspec を一度に渡しすぎて argv 上限に当たらないようにする分割単位 */
const PATHSPEC_BATCH_SIZE = 400;

/**
 * 各パスの最終コミット日時（ISO 8601）を返す。git 履歴に無いパスは欠落する。
 */
export function collectLastCommitDates(paths: readonly string[], cwd: string): Map<string, string> {
  const dates = new Map<string, string>();

  for (let offset = 0; offset < paths.length; offset += PATHSPEC_BATCH_SIZE) {
    const batch = paths.slice(offset, offset + PATHSPEC_BATCH_SIZE);
    if (batch.length === 0) continue;

    const stdout = requireGit(
      [
        'log',
        `--format=${GIT_LOG_COMMIT_MARKER}%cI`,
        '--name-only',
        '--no-renames',
        '--',
        ...batch,
      ],
      cwd,
    );

    for (const [path, committedAt] of parseGitLogFileDates(stdout)) {
      if (!dates.has(path)) dates.set(path, committedAt);
    }
  }

  return dates;
}

/** ERE のメタ文字をリテラル扱いにする（prefix は設定値なので任意の文字が来る） */
function escapeForExtendedRegExp(value: string): string {
  return value.replace(/[.[\]{}()*+?^$|\\/]/g, '\\$&');
}

/**
 * リポジトリ全文から doc パスらしき文字列を拾う。
 *
 * `git grep` を使う理由: gitignore と バイナリ判定を git 側に任せられるため、
 * node_modules や生成物を自前で除外する必要がない。
 */
export function grepDocReferences(prefixes: readonly string[], cwd: string): DocReference[] {
  if (prefixes.length === 0) return [];

  // -o（マッチ部分だけ出力）を使わないのは、外部 URL に含まれる `docs/...` を
  // 除くのに行全体の文脈が要るため。抽出は parseGitGrepMatches が行う。
  const args = ['grep', '--no-color', '-n', '-I', '-E', '--untracked'];
  for (const prefix of prefixes) {
    // 行を選ぶための粗いフィルタ。実際の抽出は parseGitGrepMatches が行うので、
    // ここは緩くてよい。空白以外を許すのは、非 ASCII のファイル名（日本語の doc）を
    // 含む行を取りこぼさないため — POSIX ERE には Unicode プロパティが無い。
    args.push('-e', `${escapeForExtendedRegExp(prefix)}[^[:space:]]*\\.mdx?`);
  }

  const result = runGit(args, cwd);
  // git grep はマッチが 1 件も無いとき exit 1 を返す（エラーではない）
  if (result.status === 1) return [];
  if (result.status !== 0) {
    throw new GitCommandFailedError(args, result.status, result.stderr);
  }

  return parseGitGrepMatches(result.stdout, buildReferencePattern(prefixes));
}
