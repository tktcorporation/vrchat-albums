#!/usr/bin/env bun
/** Connector raw REST snapshot → the same external feedback history and push policy as gh. */
import { $ } from 'bun';
import { applyFeedbackObservation } from './pr-feedback-observation.ts';
import { parseGitHubFeedback } from './pr-feedback-github.ts';
import {
  EXTERNAL_REVIEW_LIMIT,
  acknowledgeFeedback,
  judgeExternalPush,
  markFeedbackReviewed,
  needsUserDecision,
} from './pr-feedback-policy.ts';
import { writeCloudPushGrant } from './cloud-push-grant.ts';
import { isRecord, remoteIdentity } from './hook-utils.ts';
import { nowMs, parseIsoUtcMs } from './iso-time.ts';
import { remoteHeadSha } from './pr-review-gate.ts';
import { reviewRangeOf, reviewTargetSha } from './review-count.ts';
import { MIN_NOTE_LENGTH, normalizeNote } from './review-policy.ts';

type CloudEvidence = {
  repository: string;
  branch: string;
  prNumber: number;
  observedAt: string;
  viewerLogin: string;
  pr: unknown;
  comments: unknown;
  reviews: unknown;
  consultationNote?: string;
};

const sha = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);

/**
 * GitHub はリポジトリ名の大文字小文字を区別しないため、owner/repo を含む値は小文字にそろえて比べる。
 * ブランチ名と SHA は区別されるので、この比較に使わない。
 */
export function sameRepositoryText(actual: unknown, expected: string): boolean {
  return typeof actual === 'string' && actual.toLowerCase() === expected.toLowerCase();
}

/**
 * origin の URL が、観測した GitHub（github.com）の repository を指すか。書き方（scheme・ユーザー名・
 * 既定ポート・`.git`・ssh.github.com）の違いは hook-utils.ts の remoteIdentity と同じ規則でそろえる。
 * .codex/cloud-pr-feedback.cjs は TS を読み込めないので同じ規則を写して持ち、テストで一致を確かめる。
 * 空白や改行を含む値は、複数の URL が連結された出力でありうるので一致とみなさない。
 */
export function matchesGitHubRemote(remote: string, repository: string): boolean {
  if (/\s/u.test(remote)) return false;
  return remoteIdentity(remote) === `github.com/${repository}`.toLowerCase();
}

function instantMilliseconds(value: string): number | null {
  return parseIsoUtcMs(value);
}

// hook は同期先のどのリポジトリでも依存なしで動く必要があるため、スキーマライブラリを使わずに検査する。
function parseEvidence(value: unknown): CloudEvidence | null {
  // 生データ 3 項目は値の検査を後段に任せるが、キー自体の欠落はここで弾く。
  if (!isRecord(value) || !('pr' in value && 'comments' in value && 'reviews' in value))
    return null;
  const { repository, branch, prNumber, observedAt, viewerLogin, consultationNote } = value;
  if (
    typeof repository !== 'string' ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
    typeof branch !== 'string' ||
    !branch ||
    typeof prNumber !== 'number' ||
    !Number.isSafeInteger(prNumber) ||
    prNumber <= 0 ||
    typeof observedAt !== 'string' ||
    typeof viewerLogin !== 'string' ||
    !viewerLogin ||
    (consultationNote !== undefined && typeof consultationNote !== 'string')
  )
    return null;
  return {
    repository,
    branch,
    prNumber,
    observedAt,
    viewerLogin,
    pr: value.pr,
    comments: value.comments,
    reviews: value.reviews,
    ...(consultationNote === undefined ? {} : { consultationNote }),
  };
}

export function requireEvidence(value: unknown): CloudEvidence {
  const record = parseEvidence(value);
  if (!record) throw new Error('観測証拠の識別子が不正です');
  const observedTime = instantMilliseconds(record.observedAt);
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(record.observedAt) ||
    observedTime === null ||
    Math.abs(nowMs() - observedTime) > 120_000
  )
    throw new Error('観測時刻が不正です');
  return record;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('PR の生データが不正です');
  return value;
}

/** 欠損やページ跨ぎ重複を、履歴を変更する前に閉じる。 */
export function validateConnectorRows(comments: unknown, reviews: unknown): void {
  const validTime = (value: unknown): boolean =>
    typeof value === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) &&
    instantMilliseconds(value) !== null;
  if (!Array.isArray(comments) || !Array.isArray(reviews))
    throw new Error('レビュー一覧が不正です');
  for (const [rows, timeField] of [
    [comments, 'created_at'],
    [reviews, 'submitted_at'],
  ] as const) {
    const ids = new Set<number>();
    for (const raw of rows) {
      const row = asRecord(raw);
      const id = row.id;
      const reviewId = row.pull_request_review_id;
      const replyId = row.in_reply_to_id;
      if (
        typeof id !== 'number' ||
        !Number.isSafeInteger(id) ||
        id <= 0 ||
        ids.has(id) ||
        !sha(row.commit_id) ||
        (timeField === 'created_at' &&
          ((reviewId !== undefined &&
            reviewId !== null &&
            (typeof reviewId !== 'number' || !Number.isSafeInteger(reviewId) || reviewId <= 0)) ||
            (replyId !== undefined &&
              (typeof replyId !== 'number' || !Number.isSafeInteger(replyId) || replyId <= 0)))) ||
        (timeField === 'created_at'
          ? !validTime(row[timeField])
          : row[timeField] !== null && !validTime(row[timeField]))
      )
        throw new Error('レビュー項目の ID・commit・時刻が不正です');
      ids.add(id);
    }
  }
}

/** ツール出力を一定量に保ち、完全な ID 集合は履歴側だけに持つ。 */
export function summarizeComments(comments: string[]): {
  comments: string[];
  commentCount: number;
} {
  return { comments: comments.slice(-8), commentCount: comments.length };
}

export async function gitValue(cwd: string, ...args: string[]): Promise<string> {
  const result = await $`git -C ${cwd} ${args}`.quiet().nothrow();
  if (result.exitCode !== 0) throw new Error(`Git 検証に失敗しました: ${args[0]}`);
  return result.text().replace(/\r?\n$/, '');
}

/** Let Git define branch syntax; require its output to be the literal input, not an @{-N} expansion. */
export function assertGitBranch(cwd: string, branch: string): void {
  const result = Bun.spawnSync({
    cmd: ['git', 'check-ref-format', '--branch', branch],
    cwd,
    stdout: 'pipe',
    stderr: 'ignore',
  });
  if (result.exitCode !== 0 || new TextDecoder().decode(result.stdout) !== `${branch}\n`)
    throw new Error('Git ブランチ名が不正です');
}

export async function processCloudFeedback(
  cwd: string,
  mode: 'observe' | 'prepush' | 'consult',
  raw: unknown,
): Promise<{
  repository: string;
  branch: string;
  pr: number;
  head: string;
  localHead: string;
  observedAt: string;
  comments: string[];
  commentCount: number;
  verdict: string;
}> {
  const evidence = requireEvidence(raw);
  assertGitBranch(cwd, evidence.branch);
  const consultationNote = mode === 'consult' ? normalizeNote(evidence.consultationNote ?? '') : '';
  if (mode === 'consult' && consultationNote.length < MIN_NOTE_LENGTH)
    throw new Error('ユーザー判断の診断メモが不足しています');
  const pr = asRecord(evidence.pr);
  const head = asRecord(pr.head);
  const base = asRecord(pr.base);
  const headRepo = asRecord(head.repo);
  const baseRepo = asRecord(base.repo);
  validateConnectorRows(evidence.comments, evidence.reviews);
  const origin = await gitValue(cwd, 'remote', 'get-url', 'origin');
  if (!matchesGitHubRemote(origin, evidence.repository))
    throw new Error('origin と観測リポジトリが一致しません');
  const branch = await gitValue(cwd, 'symbolic-ref', '--short', 'HEAD');
  if (branch !== evidence.branch) throw new Error('作業ブランチと PR が一致しません');
  if (
    pr.number !== evidence.prNumber ||
    pr.state !== 'open' ||
    !sameRepositoryText(
      pr.html_url,
      `https://github.com/${evidence.repository}/pull/${evidence.prNumber}`,
    ) ||
    head.ref !== evidence.branch ||
    !sameRepositoryText(headRepo.full_name, evidence.repository) ||
    !sameRepositoryText(baseRepo.full_name, evidence.repository) ||
    !sha(head.sha)
  ) {
    throw new Error('PR の番号・状態・head・repository が一致しません');
  }
  // remoteHeadSha は ls-remote に上限時間と非対話の設定を付ける。ラッパーはこのスクリプトの
  // 完了を有限時間しか待たないため、リモート確認がそれより長く掛かり続ける経路を作らない。
  const remoteHead = await remoteHeadSha(cwd, evidence.branch);
  if (remoteHead === undefined || remoteHead !== head.sha)
    throw new Error('PR head と remote head が一致しません');
  const parsed = parseGitHubFeedback(
    { number: evidence.prNumber, headRefOid: head.sha },
    evidence.viewerLogin,
    evidence.comments,
    evidence.reviews,
  );
  if (parsed.kind !== 'found')
    throw new Error(parsed.kind === 'unavailable' ? parsed.reason : 'PR がありません');
  const input = { cwd };
  const currentHead = await reviewTargetSha(input);
  if (mode === 'prepush') {
    const pushDestination = await gitValue(cwd, 'remote', 'get-url', '--push', '--all', 'origin');
    if (!matchesGitHubRemote(pushDestination, evidence.repository))
      throw new Error('origin の push 先と観測リポジトリが一致しません');
    const ancestor = await $`git -C ${cwd} merge-base --is-ancestor ${remoteHead} ${currentHead}`
      .quiet()
      .nothrow();
    if (ancestor.exitCode !== 0 || remoteHead === currentHead)
      throw new Error('push するローカル HEAD が remote HEAD の新しい子孫ではありません');
    const dirty = await gitValue(cwd, 'status', '--porcelain', '--untracked-files=no');
    if (dirty) throw new Error('追跡ファイルに未コミット変更があります');
  }
  const observed = await applyFeedbackObservation(parsed, input);
  if (observed.kind !== 'found') throw new Error('外部指摘の観測に失敗しました');
  const comments = observed.history.seenComments;
  const summary = {
    repository: evidence.repository,
    branch: evidence.branch,
    pr: evidence.prNumber,
    head: remoteHead,
    localHead: currentHead,
    observedAt: evidence.observedAt,
    ...summarizeComments(comments),
  };
  if (mode === 'observe') {
    return { ...summary, verdict: 'observed' };
  }
  if (mode === 'consult') {
    if (
      observed.history.heads.length < EXTERNAL_REVIEW_LIMIT ||
      !needsUserDecision(observed.history)
    )
      throw new Error('ユーザー判断が必要な回数と診断メモを確認してください');
    await Bun.write(
      observed.path,
      JSON.stringify(
        acknowledgeFeedback(observed.history, consultationNote, observed.rounds.length),
      ),
    );
    return { ...summary, verdict: 'consulted' };
  }
  const lastReviewedSha = observed.rounds.at(-1)?.sha;
  const reviewedHeadPublished =
    !!lastReviewedSha &&
    (
      await $`git -C ${cwd} merge-base --is-ancestor ${lastReviewedSha} ${remoteHead}`
        .quiet()
        .nothrow()
    ).exitCode === 0;
  const reviewable = await reviewRangeOf(
    observed.rounds.map((round) => round.sha),
    input,
  );
  const verdict = judgeExternalPush(
    observed.history,
    observed.rounds,
    currentHead,
    reviewedHeadPublished,
    reviewable,
  );
  if (verdict !== 'allow') throw new Error(`外部レビューの push ゲート: ${verdict}`);
  if (observed.history.reviewedCommentCount < comments.length)
    await Bun.write(observed.path, JSON.stringify(markFeedbackReviewed(observed.history)));
  // 続く git push の PreToolUse hook は gh で同じ判定をやり直す。gh が使えない環境でも
  // この判定結果で通れるよう、許可した HEAD に限って短命の許可を残す。
  await writeCloudPushGrant(input, { branch, head: currentHead });
  return { ...summary, verdict };
}

if (import.meta.main) {
  const [mode] = process.argv.slice(2);
  if (mode !== 'observe' && mode !== 'prepush' && mode !== 'consult') {
    console.error(
      '使い方: JSON | bun .claude/hooks/cloud-pr-feedback.ts <observe|prepush|consult>',
    );
    process.exit(2);
  }
  try {
    const evidence: unknown = JSON.parse(await Bun.stdin.text());
    console.log(JSON.stringify(await processCloudFeedback(process.cwd(), mode, evidence)));
  } catch (error) {
    console.error(String(error));
    process.exit(2);
  }
}
