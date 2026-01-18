/**
 * 初期化進捗をtRPC subscriptionに送信するエミッター
 *
 * eventEmitterを通じてapi.tsのsubscribeInitProgressに送信する。
 * zodスキーマによる検証はsubscription側で行われる。
 */
import { eventEmitter } from '../../trpc';
import type { InitProgressPayload, InitStage } from './types';

/** イベント名 */
const INIT_PROGRESS_EVENT = 'init-progress' as const;

/**
 * 進捗イベントを送信する
 */
export const emitProgress = (payload: InitProgressPayload): void => {
  eventEmitter.emit(INIT_PROGRESS_EVENT, payload);
};

/**
 * ステージ開始を通知する
 */
export const emitStageStart = (
  stage: InitStage,
  message: string,
  total?: number,
): void => {
  emitProgress({
    stage,
    progress: 0,
    message,
    details: total !== undefined ? { current: 0, total } : undefined,
  });
};

/**
 * ステージ進捗を通知する
 */
export const emitStageProgress = (
  stage: InitStage,
  current: number,
  total: number,
  message: string,
  currentItem?: string,
): void => {
  const progress = total > 0 ? Math.round((current / total) * 100) : 0;
  emitProgress({
    stage,
    progress,
    message,
    details: {
      current,
      total,
      currentItem,
    },
  });
};

/**
 * ステージ完了を通知する
 */
export const emitStageComplete = (stage: InitStage, message: string): void => {
  emitProgress({
    stage,
    progress: 100,
    message,
  });
};

/**
 * 初期化完了を通知する
 */
export const emitInitComplete = (): void => {
  emitProgress({
    stage: 'completed',
    progress: 100,
    message: '初期化が完了しました',
  });
};

/**
 * エラー発生を通知する
 */
export const emitError = (message: string, errorDetails?: string): void => {
  emitProgress({
    stage: 'error',
    progress: 0,
    message,
    details: errorDetails ? { currentItem: errorDetails } : undefined,
  });
};
