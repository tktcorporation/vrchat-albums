#!/usr/bin/env bun
/**
 * レビューの収束を確かめてから PR を作る入口。GitHub への問い合わせは REST だけで行うので、
 * GraphQL を拒否する実行環境（`gh pr create` が使えない環境）でも、gh の REST が通れば同じ手順で使える。
 *
 * 使い方（PR の head にするブランチをチェックアウトしたディレクトリで実行する）:
 *
 *   bun .claude/hooks/create-pr.ts --title <題> --body-file <本文のファイル> [--draft] [--base <ブランチ>]
 *
 * 対象は実行時に確定させ、gh の推測には頼らない。リポジトリとホストは origin、head は現在のブランチ
 * （push 先が origin の別名のブランチならその名前）、base は origin の default branch（`origin/HEAD`）。
 * `--base` は確認のためだけに受け付け、default branch 以外なら止める（レビューは default branch との
 * 差分に対して行うため）。
 *
 * 作成の前に、PR 作成ゲート（pr-review-gate.ts の attestedRemoteHead）と同じ判定で、リモートの head の
 * SHA に収束の証跡があることを確かめる。作成の要求は GitHub に届いた後で応答が途絶えることがあるので、
 * 失敗したら再試行せずに同じ head の open な PR を探し直し、実在を確かめてから結果を返す。
 *
 * 終了コードと標準出力（理由・状態は標準エラーに書く）:
 *
 * | 終了コード | 状態       | 標準出力                 | 意味                                                        |
 * | ---------- | ---------- | ------------------------ | ----------------------------------------------------------- |
 * | 0          | created    | PR の URL 1 行           | 作成し、応答の head と base が確かめた値と一致した          |
 * | 1          | refused    | なし                     | 作成していない（前提・証跡・GitHub への接続のどれかで停止） |
 * | 2          | usage      | なし                     | 引数の誤り                                                  |
 * | 3          | exists     | 既存の PR の URL 1 行    | 同じ head の open な PR が既にあるので作成していない        |
 * | 4          | unverified | 分かれば PR の URL 1 行  | 作成されたか、されたかもしれないが、head・base を確かめられない |
 *
 * 4 のときは PR が作られている可能性があるので、再実行する前に GitHub で状態を確かめる。
 */
import { readFile } from 'node:fs/promises';
import { createGitHubPort, runGh } from './github-port.ts';
import type { GhRunner, OpenPullRequest } from './github-port.ts';
import { workingTree } from './hook-utils.ts';
import { attestedRemoteHead, baseDenyReason, originDefaultBranch } from './pr-review-gate.ts';

interface CreatePrOptions {
  title: string;
  bodyFile: string;
  draft: boolean;
  base?: string;
}

type CreatePrOutcome =
  | { kind: 'created'; url: string; note?: string }
  | { kind: 'refused'; reason: string }
  | { kind: 'exists'; url: string; reason: string }
  | { kind: 'unverified'; url: string | null; reason: string };

export const EXIT_CODE: Record<CreatePrOutcome['kind'] | 'usage', number> = {
  created: 0,
  refused: 1,
  usage: 2,
  exists: 3,
  unverified: 4,
};

const USAGE =
  'usage: bun .claude/hooks/create-pr.ts --title <題> --body-file <本文のファイル> [--draft] [--base <ブランチ>]';

/** 引数を読む。値を取るオプションは `--name <値>` の形だけを受け付け、重複と未知のオプションは誤りにする。 */
export function parseArgs(
  argv: readonly string[],
): { kind: 'ok'; options: CreatePrOptions } | { kind: 'usage'; reason: string } {
  const values = new Map<string, string>();
  let draft = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === '--draft') {
      if (draft) return { kind: 'usage', reason: '--draft が重複しています' };
      draft = true;
      continue;
    }
    if (arg !== '--title' && arg !== '--body-file' && arg !== '--base')
      return { kind: 'usage', reason: `知らない引数です: ${arg}` };
    if (values.has(arg)) return { kind: 'usage', reason: `${arg} が重複しています` };
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--'))
      return { kind: 'usage', reason: `${arg} に値がありません` };
    values.set(arg, value);
    index += 1;
  }
  const title = values.get('--title')?.trim();
  const bodyFile = values.get('--body-file');
  if (!title) return { kind: 'usage', reason: '--title を指定してください' };
  if (!bodyFile) return { kind: 'usage', reason: '--body-file を指定してください' };
  const base = values.get('--base');
  return {
    kind: 'ok',
    options: base === undefined ? { title, bodyFile, draft } : { title, bodyFile, draft, base },
  };
}

/** 確かめた head・base と、GitHub 上の PR の head・base が一致しなければ、そのずれを書いた文。 */
function mismatch(
  pr: { headSha: string; baseRef: string | null },
  expected: { headSha: string; baseRef: string },
): string | null {
  const problems: string[] = [];
  if (pr.headSha !== expected.headSha)
    problems.push(`head が ${pr.headSha}（確かめたのは ${expected.headSha}）`);
  if (pr.baseRef !== expected.baseRef)
    problems.push(`base が ${pr.baseRef ?? '不明'}（確かめたのは ${expected.baseRef}）`);
  return problems.length === 0 ? null : problems.join('、');
}

/** `cwd` のチェックアウトから PR を作る。`runner` は gh の実行（テストは差し替える）。 */
async function createReviewedPullRequest(
  options: CreatePrOptions,
  cwd: string,
  runner: GhRunner = runGh,
): Promise<CreatePrOutcome> {
  const refused = (reason: string): CreatePrOutcome => ({ kind: 'refused', reason });
  const body = await readFile(options.bodyFile, 'utf8').catch(() => null);
  if (body === null) return refused(`本文のファイル ${options.bodyFile} を読めません。`);
  const tree = await workingTree({ cwd });
  const port = createGitHubPort(tree, runner);
  const target = await port.target();
  if (target.kind !== 'ok') return refused(target.reason);
  const { owner, repo, branch } = target.value;
  const defaultBranch = await originDefaultBranch(tree);
  if (defaultBranch === null)
    return refused(
      `${tree} で origin の default branch が分からないので、PR の base を決められません。git remote set-head origin --auto を実行してから再実行してください。`,
    );
  const baseReason = await baseDenyReason(tree, options.base);
  if (baseReason) return refused(baseReason);
  if (branch === defaultBranch)
    return refused(
      `現在のブランチ ${branch} は default branch そのものなので PR の head にできません。作業用のブランチで実行してください。`,
    );

  const attested = await attestedRemoteHead(`${owner}/${repo}`, branch, tree);
  if (attested.kind === 'denied') return refused(attested.reason);
  const expected = { headSha: attested.sha, baseRef: defaultBranch };

  const existing = await port.findOpenPullRequest();
  if (existing.kind === 'unavailable') return refused(existing.reason);
  if (existing.kind === 'found')
    return {
      kind: 'exists',
      url: existing.pullRequest.url,
      reason: `${owner}/${repo} のブランチ ${branch} には open な PR #${existing.pullRequest.number} が既にあるので、作成していません。`,
    };

  const created = await port.createPullRequest({
    title: options.title,
    body,
    head: branch,
    base: defaultBranch,
    draft: options.draft,
  });
  if (created.kind === 'ok') {
    const problem = mismatch(created.value, expected);
    return problem === null
      ? { kind: 'created', url: created.value.url }
      : {
          kind: 'unverified',
          url: created.value.url,
          reason: `PR #${created.value.number} は作成されましたが、${problem}で、レビューを確かめた内容と一致しません。PR の head と base を GitHub で確かめてください。`,
        };
  }

  // 要求が届いた後で失敗したなら PR は作られている。結果を使い回さない新しい Port で探し直す。
  const recheck = await createGitHubPort(tree, runner).findOpenPullRequest();
  if (recheck.kind === 'no_pr')
    return refused(
      `PR を作成できませんでした。${created.reason} 同じ head の open な PR は見つからないので、PR は作られていません。`,
    );
  if (recheck.kind === 'unavailable')
    return {
      kind: 'unverified',
      url: null,
      reason: `作成の要求が失敗し（${created.reason}）、PR が作られたかも確かめられません（${recheck.reason}）。再実行する前に、${owner}/${repo} にブランチ ${branch} の open な PR が無いことを GitHub で確かめてください。`,
    };
  return foundAfterFailure(recheck.pullRequest, expected, created.reason);
}

function foundAfterFailure(
  pr: OpenPullRequest,
  expected: { headSha: string; baseRef: string },
  failure: string,
): CreatePrOutcome {
  const problem = mismatch(pr, expected);
  const note = `作成の要求は失敗として返りましたが（${failure}）、PR #${pr.number} は作成されていました。`;
  return problem === null
    ? { kind: 'created', url: pr.url, note }
    : {
        kind: 'unverified',
        url: pr.url,
        reason: `${note}ただし${problem}で、レビューを確かめた内容と一致しません。PR の head と base を GitHub で確かめてください。`,
      };
}

if (import.meta.main) {
  const parsed = parseArgs(Bun.argv.slice(2));
  if (parsed.kind === 'usage') {
    console.error(`${parsed.reason}\n${USAGE}`);
    process.exit(EXIT_CODE.usage);
  }
  const outcome = await createReviewedPullRequest(parsed.options, process.cwd());
  switch (outcome.kind) {
    case 'created':
      console.log(outcome.url);
      if (outcome.note) console.error(outcome.note);
      break;
    case 'exists':
      console.log(outcome.url);
      console.error(outcome.reason);
      break;
    case 'unverified':
      if (outcome.url) console.log(outcome.url);
      console.error(`未検証（PR が作成されている可能性があります）: ${outcome.reason}`);
      break;
    case 'refused':
      console.error(`PR を作成しませんでした: ${outcome.reason}`);
      break;
  }
  process.exit(EXIT_CODE[outcome.kind]);
}
