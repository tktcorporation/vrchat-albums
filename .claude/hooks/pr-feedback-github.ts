import { $ } from 'bun';
import type { FeedbackObservation } from './pr-feedback-policy.ts';

/** GitHub の返答をドメインの外部指摘へ変換する境界。 */
export type GitHubFeedback =
  | { kind: 'no_pr' }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'found'; pr: number; remoteHead: string; observations: Omit<FeedbackObservation, 'roundsAtFeedback'>[] };

interface ReviewComment {
  id: number;
  commit_id: string;
  created_at: string;
  pull_request_review_id?: number | null;
  in_reply_to_id?: number;
  user: { login: string } | null;
}

interface ReviewSubmission {
  id: number;
  commit_id: string;
  submitted_at: string | null;
  state: string;
  body: string;
  user: { login: string } | null;
}

function isReviewComment(value: unknown): value is ReviewComment {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'id' in value && typeof value.id === 'number' && Number.isInteger(value.id) &&
    'commit_id' in value && typeof value.commit_id === 'string' && value.commit_id !== '' &&
    'created_at' in value && typeof value.created_at === 'string' &&
    'user' in value && (value.user === null ||
      (typeof value.user === 'object' && value.user !== null &&
        'login' in value.user && typeof value.user.login === 'string'))
  );
}

function isReviewSubmission(value: unknown): value is ReviewSubmission {
  return typeof value === 'object' && value !== null &&
    'id' in value && typeof value.id === 'number' && Number.isInteger(value.id) &&
    'commit_id' in value && typeof value.commit_id === 'string' && value.commit_id !== '' &&
    'submitted_at' in value && (value.submitted_at === null || typeof value.submitted_at === 'string') &&
    'user' in value && (value.user === null ||
      (typeof value.user === 'object' && value.user !== null &&
        'login' in value.user && typeof value.user.login === 'string')) &&
    'state' in value && typeof value.state === 'string' &&
    'body' in value && typeof value.body === 'string';
}

async function fetchPages(tree: string, endpoint: string): Promise<unknown[] | null> {
  const response = await $`gh api ${endpoint} --paginate --slurp`.cwd(tree).quiet().nothrow();
  if (response.exitCode !== 0) return null;
  try {
    const pages: unknown = response.json();
    return Array.isArray(pages) && pages.every(Array.isArray) ? pages.flat() : null;
  } catch {
    return null;
  }
}

export async function fetchGitHubFeedback(tree: string): Promise<GitHubFeedback> {
  const pr = await $`gh pr view --json number,headRefOid`.cwd(tree).quiet().nothrow();
  if (pr.exitCode !== 0) {
    return pr.stderr.toString().includes('no pull requests found for branch')
      ? { kind: 'no_pr' }
      : { kind: 'unavailable', reason: '現在の PR を確認できませんでした' };
  }
  let view: { number?: number; headRefOid?: string };
  try {
    view = pr.json();
  } catch {
    return { kind: 'unavailable', reason: 'PR の JSON を解析できませんでした' };
  }
  const number = view.number;
  if (!Number.isInteger(number) || !number) {
    return { kind: 'unavailable', reason: 'PR 番号を読み取れませんでした' };
  }
  const me = await $`gh api user --jq .login`.cwd(tree).quiet().nothrow();
  if (me.exitCode !== 0) {
    return { kind: 'unavailable', reason: 'GitHub のログイン名を取得できませんでした' };
  }
  const comments = await fetchPages(tree, `repos/{owner}/{repo}/pulls/${number}/comments?per_page=100`);
  const reviews = await fetchPages(tree, `repos/{owner}/{repo}/pulls/${number}/reviews?per_page=100`);
  if (!comments || !reviews) {
    return { kind: 'unavailable', reason: 'PR のレビュー指摘を取得できませんでした' };
  }
  if (!comments.every(isReviewComment)) {
    return { kind: 'unavailable', reason: 'レビューコメントの項目が不足しています' };
  }
  if (!reviews.every(isReviewSubmission)) {
    return { kind: 'unavailable', reason: 'レビュー本文の項目が不足しています' };
  }
  const login = me.text().trim().toLowerCase();
  const reviewedHeads = new Map(reviews.map((review) => [review.id, review.commit_id]));
  const observations = [
    ...comments.filter((comment) => comment.user?.login.toLowerCase() !== login &&
      comment.in_reply_to_id === undefined)
      .map((comment) => ({ at: comment.created_at, id: comment.id,
        head: reviewedHeads.get(comment.pull_request_review_id ?? -1) ?? comment.commit_id,
        commentIds: [`comment:${comment.id}`] })),
    ...reviews.filter((review) => review.submitted_at !== null && review.user?.login.toLowerCase() !== login &&
      review.state === 'CHANGES_REQUESTED')
      .map((review) => ({ at: review.submitted_at!, id: review.id, head: review.commit_id,
        commentIds: [`review:${review.id}`] })),
  ].sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id)
    .map(({ head, commentIds }) => ({ head, commentIds }));
  return { kind: 'found', pr: number, remoteHead: view.headRefOid ?? '', observations };
}
