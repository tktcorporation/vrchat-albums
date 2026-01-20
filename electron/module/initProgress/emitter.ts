/**
 * 初期化進捗をtRPC subscriptionに送信するエミッター
 *
 * eventEmitterを通じてapi.tsのsubscribeInitProgressに送信する。
 * zodスキーマによる検証はsubscription側で行われる。
 */
import { eventEmitter } from '../../trpc';
import {
  INIT_PROGRESS_CHANNEL,
  type InitProgressPayload,
  type InitStage,
} from './schema';

/**
 * 進捗イベントを送信する
 */
export const emitProgress = (payload: InitProgressPayload): void => {
  eventEmitter.emit(INIT_PROGRESS_CHANNEL, payload);
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
