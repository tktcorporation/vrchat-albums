/**
 * 外部レビュー指摘を受けた PR の push を通すかの判定。push の PreToolUse hook
 * （require-pr-feedback-review.ts）と、読み取り専用の自己診断（github-doctor.ts）が同じ判定を使う。
 *
 * 基本の経路（origin の、いまのブランチの PR）で外部指摘に気付かせるための緩いガードレールで、
 * GitHub を確かめられないときは止めずに警告して通す（.claude/rules/ci-workflow.md の
 * 「push 後: レビューコメントに対応する」）。
 *
 * hook として動くときは、取得した指摘を外部レビュー履歴へ記録し、GitHub コネクタ経由の push 許可を
 * 1 回分使い切る。診断（`dryRun: true`）では同じ判定を、履歴にも許可にも書き込まずに行う。
 */
import { $ } from 'bun';
import { consumeCloudPushGrant, peekCloudPushGrant } from './cloud-push-grant.ts';
import type { GitHubPort } from './github-port.ts';
import { currentBranch, hookCommand } from './hook-utils.ts';
import type { ReviewTarget } from './hook-utils.ts';
import { previewFeedback, refreshFeedback } from './pr-feedback-observation.ts';
import { judgeExternalPush, markFeedbackReviewed } from './pr-feedback-policy.ts';
import { reviewRangeOf, reviewTargetSha } from './review-count.ts';

/**
 * 通すときは根拠を持つ。no_pr: PR が無い / no_feedback: PR に外部指摘が無い / reviewed: 指摘の後の
 * レビューが収束している / cloud_grant: gh で確かめられないが、GitHub コネクタ経由のゲートが直前に
 * 確かめている / unchecked: GitHub を確かめられないまま通す（warning を利用者とエージェントへ示す）。
 */
export type PushVerdict =
  | { kind: 'allow'; basis: 'no_pr' | 'no_feedback' | 'reviewed' | 'cloud_grant' }
  | { kind: 'allow'; basis: 'unchecked'; warning: string }
  | {
      kind: 'block';
      /** history_broken: 外部レビュー履歴が読めない / review_locally: 指摘の後のレビューが未収束 / consult_user: 相談が要る */
      basis: 'history_broken' | 'review_locally' | 'consult_user';
      message: string;
    };

/**
 * `target` のチェックアウトから現在の HEAD を push してよいか。`port` は同じチェックアウトを対象に
 * した GitHub の Port（省略すると作る）。
 */
export async function evaluatePushGate(
  target: ReviewTarget,
  options: { dryRun: boolean; port?: GitHubPort },
): Promise<PushVerdict> {
  const feedback = options.dryRun
    ? await previewFeedback(target, options.port)
    : await refreshFeedback(target, options.port);
  if (feedback.kind === 'no_pr') return { kind: 'allow', basis: 'no_pr' };
  if (feedback.kind === 'unavailable') {
    // 手元の履歴が壊れているときは、直せば判定できるので止める。
    if (feedback.cause === 'history_broken')
      return {
        kind: 'block',
        basis: 'history_broken',
        message: `${feedback.reason}履歴ファイルを直すか取り除き、${hookCommand('observe-pr-feedback.ts')} で指摘を観測し直してから push してください。`,
      };
    // GitHub コネクタ経由のゲートが直前に確かめた push は、警告なしで通す。
    const pushTarget = {
      branch: await currentBranch(target.cwd),
      head: await reviewTargetSha(target),
    };
    const grantError = options.dryRun
      ? await peekCloudPushGrant(target, pushTarget)
      : await consumeCloudPushGrant(target, pushTarget);
    if (grantError === null) return { kind: 'allow', basis: 'cloud_grant' };
    return {
      kind: 'allow',
      basis: 'unchecked',
      warning: `PR の外部レビュー指摘を確かめられないまま push を通します。${feedback.reason}どこで止まっているかは ${hookCommand('github-doctor.ts')} で確かめられます。`,
    };
  }
  const { history, rounds, path: historyPath, remoteHead } = feedback;
  if (history.heads.length === 0) return { kind: 'allow', basis: 'no_feedback' };
  const sha = await reviewTargetSha(target);
  const reviewedSha = rounds.at(-1)?.sha;
  const published =
    !!reviewedSha &&
    !!remoteHead &&
    (
      await $`git merge-base --is-ancestor ${reviewedSha} ${remoteHead}`
        .cwd(target.cwd)
        .quiet()
        .nothrow()
    ).exitCode === 0;
  const reviewable = await reviewRangeOf(
    rounds.map((round) => round.sha),
    target,
  );
  const verdict = judgeExternalPush(history, rounds, sha, published, reviewable);
  if (verdict === 'consult_user') {
    return {
      kind: 'block',
      basis: 'consult_user',
      message: `この PR では異なる HEAD への外部レビュー指摘が ${history.heads.length} 回続いています。修正と push を止め、各回の指摘とローカルレビューで見逃した理由を根本原因ごとに整理し、なぜレビューが続くのか診断してください。設計・要件・レビュー手順を変える具体案を効果と影響で比較し、推奨案を添えてユーザーに採る方針を尋ねてください。レビューを続けるかだけの質問では足りません。答えを得た後に ${hookCommand('record-pr-feedback.ts')} asked "<診断とユーザーが選んだ方針>" で記録してください。`,
    };
  }
  if (verdict === 'review_locally') {
    return {
      kind: 'block',
      basis: 'review_locally',
      message: `外部レビュー指摘の観測後に 2 ラウンドのセルフレビューが現在の HEAD で収束していません。.claude/skills/pr-review-loop/SKILL.md の手順で差分全体をレビューし、${hookCommand('record-pr-review.ts')} で記録してから push してください。`,
    };
  }
  if (!options.dryRun && history.reviewedCommentCount < history.seenComments.length) {
    await Bun.write(historyPath, JSON.stringify(markFeedbackReviewed(history)));
  }
  return { kind: 'allow', basis: 'reviewed' };
}
