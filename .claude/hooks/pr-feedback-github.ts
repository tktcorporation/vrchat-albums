import { $ } from 'bun';
import type { FeedbackObservation } from './pr-feedback-policy.ts';

/** GitHub の返答をドメインの外部指摘へ変換する境界。 */
export type GitHubFeedback =
  | { kind: 'no_pr' }
  | { kind: 'unavailable'; reason: string }
  | {
      kind: 'found';
      pr: number;
      remoteHead: string;
      observations: Omit<FeedbackObservation, 'roundsAtFeedback'>[];
    };

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
  user: { login: string } | null;
}

function isReviewComment(value: unknown): value is ReviewComment {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'id' in value &&
    typeof value.id === 'number' &&
    Number.isInteger(value.id) &&
    'commit_id' in value &&
    typeof value.commit_id === 'string' &&
    value.commit_id !== '' &&
    'created_at' in value &&
    typeof value.created_at === 'string' &&
    'user' in value &&
    (value.user === null ||
      (typeof value.user === 'object' &&
        value.user !== null &&
        'login' in value.user &&
        typeof value.user.login === 'string'))
  );
}

function isReviewSubmission(value: unknown): value is ReviewSubmission {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'number' &&
    Number.isInteger(value.id) &&
    'commit_id' in value &&
    typeof value.commit_id === 'string' &&
    value.commit_id !== '' &&
    'submitted_at' in value &&
    (value.submitted_at === null || typeof value.submitted_at === 'string') &&
    'user' in value &&
    (value.user === null ||
      (typeof value.user === 'object' &&
        value.user !== null &&
        'login' in value.user &&
        typeof value.user.login === 'string')) &&
    'state' in value &&
    typeof value.state === 'string'
  );
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

/** CLI と cloud connector の raw REST payload に同じ検証・抽出を適用する。 */
export function parseGitHubFeedback(
  view: unknown,
  viewerLogin: unknown,
  comments: unknown,
  reviews: unknown,
): GitHubFeedback {
  if (typeof view !== 'object' || view === null) {
    return { kind: 'unavailable', reason: 'PR の JSON を解析できませんでした' };
  }
  const number = 'number' in view ? view.number : undefined;
  const remoteHead = 'headRefOid' in view ? view.headRefOid : undefined;
  if (typeof number !== 'number' || !Number.isInteger(number) || !number) {
    return { kind: 'unavailable', reason: 'PR 番号を読み取れませんでした' };
  }
  if (typeof viewerLogin !== 'string' || !viewerLogin.trim()) {
    return { kind: 'unavailable', reason: 'GitHub のログイン名を取得できませんでした' };
  }
  if (!Array.isArray(comments) || !comments.every(isReviewComment)) {
    return { kind: 'unavailable', reason: 'レビューコメントの項目が不足しています' };
  }
  if (!Array.isArray(reviews) || !reviews.every(isReviewSubmission)) {
    return { kind: 'unavailable', reason: 'レビューの項目が不足しています' };
  }
  const login = viewerLogin.trim().toLowerCase();
  const reviewedHeads = new Map(reviews.map((review) => [review.id, review.commit_id]));
  const observations = [
    ...comments
      .filter(
        (comment) =>
          comment.user?.login.toLowerCase() !== login && comment.in_reply_to_id === undefined,
      )
      .map((comment) => ({
        at: comment.created_at,
        id: comment.id,
        head: reviewedHeads.get(comment.pull_request_review_id ?? -1) ?? comment.commit_id,
        commentIds: [`comment:${comment.id}`],
      })),
    ...reviews
      .filter(
        (review) =>
          review.submitted_at !== null &&
          review.user?.login.toLowerCase() !== login &&
          review.state === 'CHANGES_REQUESTED',
      )
      .map((review) => ({
        at: review.submitted_at!,
        id: review.id,
        head: review.commit_id,
        commentIds: [`review:${review.id}`],
      })),
  ]
    .sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id)
    .map(({ head, commentIds }) => ({ head, commentIds }));
  return {
    kind: 'found',
    pr: number,
    remoteHead: typeof remoteHead === 'string' ? remoteHead : '',
    observations,
  };
}

export async function fetchGitHubFeedback(tree: string): Promise<GitHubFeedback> {
  const pr = await $`gh pr view --json number,headRefOid`.cwd(tree).quiet().nothrow();
  if (pr.exitCode !== 0) {
    return pr.stderr.toString().includes('no pull requests found for branch')
      ? { kind: 'no_pr' }
      : { kind: 'unavailable', reason: '現在の PR を確認できませんでした' };
  }
  let view: unknown;
  try {
    view = pr.json();
  } catch {
    return { kind: 'unavailable', reason: 'PR の JSON を解析できませんでした' };
  }
  if (typeof view !== 'object' || view === null || !('number' in view))
    return { kind: 'unavailable', reason: 'PR 番号を読み取れませんでした' };
  const number = view.number;
  if (typeof number !== 'number' || !Number.isInteger(number) || !number)
    return { kind: 'unavailable', reason: 'PR 番号を読み取れませんでした' };
  let login = '';
  const me = await $`gh api user --jq .login`.cwd(tree).quiet().nothrow();
  if (me.exitCode === 0 && me.text().trim()) {
    login = me.text().trim();
  } else {
    const authStatus = await $`gh auth status`.cwd(tree).quiet().nothrow();
    const match = /account\s+([A-Za-z0-9_.-]+)/i.exec(
      authStatus.stdout.toString() + authStatus.stderr.toString(),
    );
    if (match?.[1]) {
      login = match[1];
    }
  }
  if (!login) {
    return { kind: 'unavailable', reason: 'GitHub のログイン名を取得できませんでした' };
  }
  const comments = await fetchPages(
    tree,
    `repos/{owner}/{repo}/pulls/${number}/comments?per_page=100`,
  );
  const reviews = await fetchPages(
    tree,
    `repos/{owner}/{repo}/pulls/${number}/reviews?per_page=100`,
  );
  if (!comments || !reviews) {
    return { kind: 'unavailable', reason: 'PR のレビュー指摘を取得できませんでした' };
  }
  return parseGitHubFeedback(view, login, comments, reviews);
}
