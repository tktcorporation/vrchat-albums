/**
 * 初期化進捗をレンダラに送信するエミッター
 */
import type { BrowserWindow } from 'electron';
import { logger } from '../../lib/logger';
import {
  INIT_PROGRESS_CHANNEL,
  type InitProgressPayload,
  type InitStage,
} from './types';

// メインウィンドウの参照を保持
let mainWindow: BrowserWindow | null = null;

/**
 * メインウィンドウを設定する
 * main.ts で BrowserWindow 作成後に呼び出す
 */
export const setMainWindow = (window: BrowserWindow): void => {
  mainWindow = window;
};

/**
 * メインウィンドウの参照をクリアする
 */
export const clearMainWindow = (): void => {
  mainWindow = null;
};

/**
 * 進捗イベントをレンダラに送信する
 */
export const emitProgress = (payload: InitProgressPayload): void => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    logger.debug('Cannot emit progress: mainWindow not available');
    return;
  }

  try {
    mainWindow.webContents.send(INIT_PROGRESS_CHANNEL, payload);
  } catch (error) {
    logger.warn('Failed to emit progress:', error);
  }
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
