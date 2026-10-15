import { parseExternalReviewHistory } from './pr-feedback-history.ts';
import { describe, expect, test } from 'bun:test';
import {
  EXTERNAL_REVIEW_LIMIT,
  acknowledgeFeedback,
  judgeExternalPush,
  markFeedbackReviewed,
  needsUserDecision,
  newExternalReviewHistory,
  observeFeedback,
} from './pr-feedback-policy.ts';

const observe = (
  history: ReturnType<typeof newExternalReviewHistory>,
  head: string,
  id: string,
  roundsAtFeedback: number,
) => observeFeedback(history, { head, commentIds: [id], roundsAtFeedback });

describe('外部レビューの往復', () => {
  test('同じ HEAD の複数コメントは相談回数を増やさず、新しいレビューを要求する', () => {
    const first = observe(newExternalReviewHistory(42), 'a', 'one', 1);
    const second = observe(first, 'a', 'two', 2);
    expect(second.heads).toEqual(['a']);
    expect(second.roundsAtLastFeedback).toBe(2);
    expect(judgeExternalPush(second, [], 'a')).toBe('review_locally');
    expect(observe(second, 'a', 'one', 3)).toEqual(second);
  });

  test('異なる HEAD に 3 回指摘が届いたら相談し、回答後に再開できる', () => {
    const history = ['a', 'b', 'c'].reduce(
      (current, head, index) => observe(current, head, `comment-${index}`, index + 1),
      newExternalReviewHistory(42),
    );
    expect(history.heads).toHaveLength(EXTERNAL_REVIEW_LIMIT);
    expect(needsUserDecision(history)).toBe(true);
    const answered = acknowledgeFeedback(history, 'ユーザーに全指摘と設計案を示し、修正の続行を指示された', 3);
    expect(needsUserDecision(answered)).toBe(false);
    expect(needsUserDecision(observe(answered, 'd', 'comment-4', 4))).toBe(true);
  });

  test('PR 番号が変わったら履歴を引き継がない', () => {
    const text = JSON.stringify(observe(newExternalReviewHistory(42), 'a', 'one', 1));
    expect(parseExternalReviewHistory(text, 43)).toEqual({
      kind: 'ready',
      history: newExternalReviewHistory(43),
    });
  });

  test('壊れた履歴と不正なユーザー判断は明示的に拒否する', () => {
    expect(parseExternalReviewHistory('{', 42)).toEqual({ kind: 'invalid' });
    const invalid = { ...newExternalReviewHistory(42), consultation: { kind: 'answered', through: 3, note: '' } };
    expect(parseExternalReviewHistory(JSON.stringify(invalid), 42)).toEqual({ kind: 'invalid' });
  });
});

test('push は最新の指摘後に現在の HEAD で収束した場合だけ通す', () => {
  const history = observe(newExternalReviewHistory(42), 'a', 'one', 2);
  const rounds = [
    { count: 1, sha: 'a', reviewer: 'other' as const, accepted: false },
    { count: 0, sha: 'a', reviewer: 'codex' as const, accepted: false },
  ];
  expect(judgeExternalPush(history, rounds, 'a')).toBe('review_locally');
  expect(judgeExternalPush(history, [...rounds, rounds[1]], 'b')).toBe('review_locally');
  expect(judgeExternalPush(history, [...rounds, rounds[1]], 'a')).toBe('review_locally');
  expect(judgeExternalPush(history, [...rounds, rounds[0], rounds[1]], 'a')).toBe('allow');
  expect(judgeExternalPush(markFeedbackReviewed(history), [...rounds, rounds[0], rounds[1]], 'new-sha')).toBe('review_locally');
  expect(judgeExternalPush(markFeedbackReviewed(history), [...rounds, rounds[0], rounds[1]], 'new-sha', true)).toBe('allow');
  const third = observe(observe(history, 'b', 'two', 3), 'c', 'three', 3);
  expect(judgeExternalPush(third, rounds, 'a')).toBe('consult_user');
});
