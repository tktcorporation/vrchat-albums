/**
 * 1 回の実行の中で、送ってよい進捗かどうかを判定する純粋関数。
 *
 * 送信側（emitter）がこれを通すことで、ストリームの不変条件
 * 「ステージは前にしか進まない」「同じステージの中で progress は減らない」を保証する。
 */
import { match } from 'ts-pattern';

import { PROGRESS_STAGES, type ProgressStage } from './schema';

/** 最後に送った進捗の位置 */
export interface ProgressCursor {
  readonly stageIndex: number;
  readonly progress: number;
}

export type CursorDecision =
  | { readonly kind: 'accept'; readonly cursor: ProgressCursor }
  /** 既に先のステージへ進んでいるため送らない */
  | { readonly kind: 'reject_backward'; readonly cursor: ProgressCursor };

const toPercent = (progress: number): number =>
  Math.min(100, Math.max(0, Math.round(progress)));

/**
 * 次に送る進捗を決める。
 *
 * - 先のステージ: そのまま受け付ける（途中のステージを飛ばしてよい）
 * - 同じステージ: progress を前回値以上に切り上げて受け付ける
 * - 前のステージ: 受け付けない
 *
 * @param cursor 最後に送った位置。まだ何も送っていなければ null
 */
export const advanceProgressCursor = (
  cursor: ProgressCursor | null,
  stage: ProgressStage,
  progress: number,
): CursorDecision => {
  const stageIndex = PROGRESS_STAGES.indexOf(stage);
  const percent = toPercent(progress);
  if (cursor === null) {
    return { kind: 'accept', cursor: { stageIndex, progress: percent } };
  }
  return match(Math.sign(stageIndex - cursor.stageIndex))
    .with(1, () => ({
      kind: 'accept' as const,
      cursor: { stageIndex, progress: percent },
    }))
    .with(0, () => ({
      kind: 'accept' as const,
      cursor: { stageIndex, progress: Math.max(cursor.progress, percent) },
    }))
    .otherwise(() => ({ kind: 'reject_backward' as const, cursor }));
};
