/**
 * 初期化進捗をレンダラに送信するエミッター
 */
import type { BrowserWindow } from 'electron';
import { err, fromThrowable, type Result } from 'neverthrow';
import { match } from 'ts-pattern';
import { logger } from '../../lib/logger';
import {
  INIT_PROGRESS_CHANNEL,
  type InitProgressPayload,
  InitProgressPayloadSchema,
  type InitStage,
} from './types';

/**
 * 進捗送信のエラー型
 */
export type EmitProgressError =
  | { type: 'WINDOW_NOT_AVAILABLE'; message: string }
  | { type: 'WINDOW_DESTROYED'; message: string }
  | { type: 'VALIDATION_ERROR'; message: string }
  | { type: 'IPC_SEND_ERROR'; message: string };

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
 * 進捗イベントをレンダラに送信する（Result型を返す）
 */
export const emitProgressWithResult = (
  payload: InitProgressPayload,
): Result<void, EmitProgressError> => {
  // ウィンドウの状態チェック
  if (!mainWindow) {
    return err({
      type: 'WINDOW_NOT_AVAILABLE',
      message: 'mainWindow is not set',
    });
  }

  if (mainWindow.isDestroyed()) {
    return err({
      type: 'WINDOW_DESTROYED',
      message: 'mainWindow has been destroyed',
    });
  }

  // ペイロードの検証とIPC送信
  const validationResult = InitProgressPayloadSchema.safeParse(payload);

  return match(validationResult)
    .with({ success: false }, (r) =>
      err({
        type: 'VALIDATION_ERROR' as const,
        message: r.error.message,
      }),
    )
    .with({ success: true }, (r) => {
      // IPC送信（fromThrowableを使用）
      const sendMessage = fromThrowable(
        () => {
          mainWindow?.webContents.send(INIT_PROGRESS_CHANNEL, r.data);
        },
        (error): EmitProgressError => ({
          type: 'IPC_SEND_ERROR',
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      return sendMessage();
    })
    .exhaustive();
};

/**
 * 進捗イベントをレンダラに送信する
 * エラーは内部でログ出力して握りつぶす（進捗報告の失敗でアプリを止めない）
 */
export const emitProgress = (payload: InitProgressPayload): void => {
  const result = emitProgressWithResult(payload);

  if (result.isErr()) {
    match(result.error)
      .with(
        { type: 'WINDOW_NOT_AVAILABLE' },
        { type: 'WINDOW_DESTROYED' },
        () => {
          // ウィンドウ未設定/破棄済みは正常な状態（デバッグログのみ）
          logger.debug(`Cannot emit progress: ${result.error.message}`);
        },
      )
      .with({ type: 'VALIDATION_ERROR' }, (e) => {
        // バリデーションエラーは警告（開発時のバグ検出）
        logger.warn(`Invalid progress payload: ${e.message}`);
      })
      .with({ type: 'IPC_SEND_ERROR' }, (e) => {
        // IPC送信エラーは警告
        logger.warn(`Failed to emit progress: ${e.message}`);
      })
      .exhaustive();
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
