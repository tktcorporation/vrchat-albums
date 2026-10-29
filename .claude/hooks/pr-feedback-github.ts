import { createGitHubPort } from './github-port.ts';
import type { GitHubPort, GitHubUnavailableCause } from './github-port.ts';
import type { FeedbackObservation } from './pr-feedback-policy.ts';

/** GitHub の返答をドメインの外部指摘へ変換する境界。 */
export type GitHubFeedback =
  | { kind: 'no_pr' }
  | { kind: 'unavailable'; cause: GitHubUnavailableCause; reason: string }
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

/** CLI と cloud connector の raw REST payload に同じ検証・抽出を適用する。 */
export function parseGitHubFeedback(
  view: unknown,
  viewerLogin: unknown,
  comments: unknown,
  reviews: unknown,
): GitHubFeedback {
  if (typeof view !== 'object' || view === null) {
    return { kind: 'unavailable', cause: 'unknown', reason: 'PR の JSON を解析できませんでした' };
  }
  const number = 'number' in view ? view.number : undefined;
  const remoteHead = 'headRefOid' in view ? view.headRefOid : undefined;
  if (typeof number !== 'number' || !Number.isInteger(number) || !number) {
    return { kind: 'unavailable', cause: 'unknown', reason: 'PR 番号を読み取れませんでした' };
  }
  if (typeof viewerLogin !== 'string' || !viewerLogin.trim()) {
    return {
      kind: 'unavailable',
      cause: 'unknown',
      reason: 'GitHub のログイン名を取得できませんでした',
    };
  }
  if (!Array.isArray(comments) || !comments.every(isReviewComment)) {
    return {
      kind: 'unavailable',
      cause: 'unknown',
      reason: 'レビューコメントの項目が不足しています',
    };
  }
  if (!Array.isArray(reviews) || !reviews.every(isReviewSubmission)) {
    return { kind: 'unavailable', cause: 'unknown', reason: 'レビューの項目が不足しています' };
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

/**
 * 現在のブランチの PR に付いた外部指摘を GitHub から取る。GitHub への問い合わせは Port
 * （github-port.ts）を通すので、GraphQL を拒否する実行環境でも REST だけで判定できる。
 * `port` を渡すと、同じ hook 実行の中で取得済みの PR・ログイン名を使い回す。
 */
export async function fetchGitHubFeedback(
  tree: string,
  port: GitHubPort = createGitHubPort(tree),
): Promise<GitHubFeedback> {
  const lookup = await port.findOpenPullRequest();
  if (lookup.kind === 'no_pr') return lookup;
  if (lookup.kind === 'unavailable') return lookup;
  const { number, headSha } = lookup.pullRequest;
  const login = await port.viewerLogin();
  if (login.kind === 'unavailable') return login;
  const comments = await port.reviewComments(number);
  if (comments.kind === 'unavailable') return comments;
  const reviews = await port.reviews(number);
  if (reviews.kind === 'unavailable') return reviews;
  return parseGitHubFeedback(
    { number, headRefOid: headSha },
    login.value,
    comments.value,
    reviews.value,
  );
}
