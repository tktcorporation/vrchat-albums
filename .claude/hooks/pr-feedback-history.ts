import { EXTERNAL_REVIEW_LIMIT, newExternalReviewHistory } from './pr-feedback-policy.ts';
import type { ExternalReviewHistory } from './pr-feedback-policy.ts';

export type ParsedHistory =
  | { kind: 'ready'; history: ExternalReviewHistory }
  | { kind: 'invalid' };

/** ディスクの JSON を境界で解釈する。PR が変われば新しい履歴、破損なら明示的な失敗。 */
export function parseExternalReviewHistory(text: string, pr: number): ParsedHistory {
  if (text.trim() === '') return { kind: 'ready', history: newExternalReviewHistory(pr) };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { kind: 'invalid' };
  }
  if (typeof value !== 'object' || value === null || !('pr' in value)) {
    return { kind: 'invalid' };
  }
  if (value.pr !== pr) return { kind: 'ready', history: newExternalReviewHistory(pr) };
  if (
    !('heads' in value) ||
    !Array.isArray(value.heads) ||
    !value.heads.every((head) => typeof head === 'string') ||
    new Set(value.heads).size !== value.heads.length ||
    !('seenComments' in value) ||
    !Array.isArray(value.seenComments) ||
    !value.seenComments.every((comment) => typeof comment === 'string') ||
    new Set(value.seenComments).size !== value.seenComments.length ||
    value.heads.length > value.seenComments.length ||
    !('roundsAtLastFeedback' in value) ||
    typeof value.roundsAtLastFeedback !== 'number' ||
    !Number.isInteger(value.roundsAtLastFeedback) ||
    value.roundsAtLastFeedback < 0 ||
    !('reviewedCommentCount' in value) ||
    typeof value.reviewedCommentCount !== 'number' ||
    !Number.isInteger(value.reviewedCommentCount) ||
    value.reviewedCommentCount < 0 ||
    value.reviewedCommentCount > value.seenComments.length ||
    (value.heads.length === 0 && value.seenComments.length !== 0) ||
    (value.heads.length > 0 && value.seenComments.length === 0) ||
    !('consultation' in value) ||
    typeof value.consultation !== 'object' ||
    value.consultation === null ||
    !('kind' in value.consultation)
  ) {
    return { kind: 'invalid' };
  }
  const consultation = value.consultation;
  if (consultation.kind === 'answered') {
    if (
      !('through' in consultation) ||
      typeof consultation.through !== 'number' ||
      !Number.isInteger(consultation.through) ||
      consultation.through < EXTERNAL_REVIEW_LIMIT ||
      consultation.through > value.heads.length ||
      !('note' in consultation) ||
      typeof consultation.note !== 'string' ||
      consultation.note.trim() === '' ||
      !('roundsAtConsultation' in consultation) ||
      typeof consultation.roundsAtConsultation !== 'number' ||
      !Number.isInteger(consultation.roundsAtConsultation) ||
      consultation.roundsAtConsultation < 0
    ) {
      return { kind: 'invalid' };
    }
    return {
      kind: 'ready',
      history: {
        pr,
        heads: value.heads,
        seenComments: value.seenComments,
        consultation: {
          kind: 'answered',
          through: consultation.through,
          note: consultation.note,
          roundsAtConsultation: consultation.roundsAtConsultation,
        },
        roundsAtLastFeedback: value.roundsAtLastFeedback,
        reviewedCommentCount: value.reviewedCommentCount,
      },
    };
  }
  if (consultation.kind !== 'none') return { kind: 'invalid' };
  return {
    kind: 'ready',
    history: {
      pr,
      heads: value.heads,
      seenComments: value.seenComments,
      consultation: { kind: 'none' },
      roundsAtLastFeedback: value.roundsAtLastFeedback,
      reviewedCommentCount: value.reviewedCommentCount,
    },
  };
}
