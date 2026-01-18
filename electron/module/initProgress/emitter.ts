/**
 * 初期化進捗をtRPC subscriptionに送信するエミッター
 *
 * eventEmitterを通じてapi.tsのsubscribeInitProgressに送信する。
 * zodスキーマによる検証はsubscription側で行われる。
 */
import { eventEmitter } from '../../trpc';
import { INIT_PROGRESS_CHANNEL } from './schema';
import type { InitProgressPayload, InitStage } from './types';

/**
 * デバッグ用遅延を取得する（実行時に評価）
 * 環境変数 DEBUG_INIT_PROGRESS_DELAY で設定可能
 * 例: DEBUG_INIT_PROGRESS_DELAY=1000 yarn dev
 */
const getDebugDelayMs = (): number => {
  const envValue = process.env.DEBUG_INIT_PROGRESS_DELAY;
  return envValue ? Number.parseInt(envValue, 10) : 0;
};

/**
 * デバッグ用のsleep関数
 */
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 進捗イベントを送信する
 */
export const emitProgress = (payload: InitProgressPayload): void => {
  eventEmitter.emit(INIT_PROGRESS_CHANNEL, payload);
};

/**
 * 進捗イベントを送信する（デバッグ遅延付き）
 * ステージ開始時に使用し、処理を一時停止させる
 */
export const emitProgressWithDelay = async (
  payload: InitProgressPayload,
): Promise<void> => {
  emitProgress(payload);
  const delayMs = getDebugDelayMs();
  if (delayMs > 0) {
    console.log(
      `[initProgress] Waiting ${delayMs}ms for stage: ${payload.stage}`,
    );
    await sleep(delayMs);
  }
};

/**
 * ステージ開始を通知する
 * デバッグモード時は遅延を入れて進捗表示を確認しやすくする
 */
export const emitStageStart = async (
  stage: InitStage,
  message: string,
  total?: number,
): Promise<void> => {
  await emitProgressWithDelay({
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
