import { Effect } from 'effect';
import { logger } from '../../lib/logger';
import { emitProgress, emitStageStart } from '../initProgress/emitter';
import type { LogInfoError } from '../logInfo/error';
import type { LogInfoServiceError } from '../logInfo/errors';
import { loadLogInfoIndexFromVRChatLog } from '../logInfo/service';
import { getSettingStore } from '../settingStore';
import type { VRChatPlayerJoinLogModel } from '../VRChatPlayerJoinLogModel/playerJoinInfoLog.model';
import type { VRChatPlayerLeaveLogModel } from '../VRChatPlayerLeaveLogModel/playerLeaveLog.model';
import { VRChatLogFileError } from '../vrchatLog/error';
import type { VRChatLogError } from '../vrchatLog/errors';
import type { AppendLoglinesResult } from '../vrchatLog/vrchatLogController';
import { appendLoglinesToFileFromLogFilePathList } from '../vrchatLog/vrchatLogController';
import type { VRChatPhotoPathModel } from '../vrchatPhoto/model/vrchatPhotoPath.model';
import type { VRChatWorldJoinLogModel } from '../vrchatWorldJoinLog/VRChatWorldJoinLogModel/s_model';
import { generateMissingWorldJoinImages } from '../worldJoinImage/service';

interface LogSyncResults {
  createdWorldJoinLogModelList: VRChatWorldJoinLogModel[];
  createdPlayerJoinLogModelList: VRChatPlayerJoinLogModel[];
  createdPlayerLeaveLogModelList: VRChatPlayerLeaveLogModel[];
  createdVRChatPhotoPathModelList: VRChatPhotoPathModel[];
}

/**
 * ログ同期のモード定義
 */
export const LOG_SYNC_MODE = {
  /**
   * 全件処理モード
   * - 初回起動時
   * - 設定画面からの手動更新時
   */
  FULL: 'FULL',
  /**
   * 差分処理モード
   * - 通常の更新時
   * - バックグラウンド更新時
   */
  INCREMENTAL: 'INCREMENTAL',
} as const;

export type LogSyncMode = (typeof LOG_SYNC_MODE)[keyof typeof LOG_SYNC_MODE];

/**
 * ログの同期処理を統一的に実行するサービス
 *
 * このサービスは以下の処理を順番に実行します：
 * 1. appendLoglines: VRChatのログファイルから新しいログ行を抽出し、アプリ内のログストアに保存
 * 2. loadLogInfo: 保存されたログをデータベースに読み込む
 *
 * @param mode 同期モード (FULL: 全件処理, INCREMENTAL: 差分処理)
 * @returns 処理結果（作成されたログ情報を含む）
 */
export function syncLogs(
  mode: LogSyncMode,
): Effect.Effect<
  LogSyncResults,
  VRChatLogFileError | VRChatLogError | LogInfoError | LogInfoServiceError
> {
  return Effect.gen(function* () {
    const isFullSync = mode === LOG_SYNC_MODE.FULL;

    logger.info(`Starting log sync with mode: ${mode}`);

    // Step 1: VRChatログファイルから新しいログ行を抽出・保存
    emitStageStart('log_append', 'VRChatログファイルを読み込んでいます...');
    const appendResult: AppendLoglinesResult = yield* Effect.tryPromise({
      try: () => appendLoglinesToFileFromLogFilePathList(isFullSync),
      catch: (error) => {
        logger.error({
          message: 'Failed to append log lines',
          details: {
            error: error instanceof Error ? error.message : String(error),
          },
        });
        if (error instanceof VRChatLogFileError) {
          return error;
        }
        return new VRChatLogFileError({
          code: 'UNKNOWN',
          message: error instanceof Error ? error.message : String(error),
        });
      },
    });
    emitProgress({
      stage: 'log_append',
      progress: 100,
      message: 'VRChatログファイルの読み込みが完了しました',
    });

    // Step 2: 保存されたログをデータベースに読み込む
    // INCREMENTAL モードでは step1 で処理済みのログ行を直接渡し、
    // logStore ファイルの再読み込みをスキップする
    emitStageStart('log_load', 'ログデータをデータベースに保存しています...');
    const loadResult = yield* loadLogInfoIndexFromVRChatLog({
      excludeOldLogLoad: !isFullSync,
      preLoadedLogLines: !isFullSync
        ? appendResult.processedLogLines
        : undefined,
    });
    emitProgress({
      stage: 'log_load',
      progress: 100,
      message: 'ログデータの保存が完了しました',
    });

    logger.info(`Log sync completed successfully with mode: ${mode}`);

    // Fire-and-forget: ワールド参加画像の自動生成（syncLogs の結果をブロックしない）
    triggerWorldJoinImageGeneration();

    return loadResult;
  });
}

/**
 * 設定が有効な場合、未生成の World Join 画像を生成する
 *
 * 背景: syncLogs 完了後に非同期で実行される。
 * syncLogs の結果には影響しないため fire-and-forget で呼び出す。
 * エラーはログに記録するのみ（Sentry 経由で検知可能）。
 */
function triggerWorldJoinImageGeneration(): void {
  // effect-lint-allow-try-catch: getSettingStore() が初期化前に呼ばれた場合のエラーハンドリング
  try {
    const settingStore = getSettingStore();
    if (!settingStore.getWorldJoinImageGenerationEnabled()) {
      return;
    }

    const photoDirPath = settingStore.getVRChatPhotoDir();
    if (!photoDirPath) {
      return;
    }

    void Effect.runPromise(
      generateMissingWorldJoinImages({ photoDirPath }),
    ).catch((error) => {
      logger.error({
        message: 'Failed to generate world join images',
        stack: error instanceof Error ? error : new Error(String(error)),
      });
    });
  } catch (error) {
    // getSettingStore() が初期化前に呼ばれた場合など
    logger.error({
      message: 'Failed to trigger world join image generation',
      stack: error instanceof Error ? error : new Error(String(error)),
    });
  }
}

/**
 * バックグラウンド処理用のログ同期
 * 差分処理モードで実行される
 */
export function syncLogsInBackground(): Effect.Effect<
  LogSyncResults,
  VRChatLogFileError | VRChatLogError | LogInfoError | LogInfoServiceError
> {
  return syncLogs(LOG_SYNC_MODE.INCREMENTAL);
}
