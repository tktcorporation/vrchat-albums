import * as neverthrow from 'neverthrow';
import { logger } from '../../lib/logger';
import { loadLogInfoIndexFromVRChatLog } from '../logInfo/service';
import type { VRChatPlayerJoinLogModel } from '../VRChatPlayerJoinLogModel/playerJoinInfoLog.model';
import type { VRChatPlayerLeaveLogModel } from '../VRChatPlayerLeaveLogModel/playerLeaveLog.model';
import type { VRChatLogFileError } from '../vrchatLog/error';
import { appendLoglinesToFileFromLogFilePathList } from '../vrchatLog/vrchatLogController';
import type { VRChatPhotoPathModel } from '../vrchatPhoto/model/vrchatPhotoPath.model';
import type { VRChatWorldJoinLogModel } from '../vrchatWorldJoinLog/VRChatWorldJoinLogModel/s_model';

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
export async function syncLogs(
  mode: LogSyncMode,
): Promise<neverthrow.Result<LogSyncResults, VRChatLogFileError>> {
  const isFullSync = mode === LOG_SYNC_MODE.FULL;

  logger.info(`Starting log sync with mode: ${mode}`);

  // Step 1: VRChatログファイルから新しいログ行を抽出・保存
  const appendResult =
    await appendLoglinesToFileFromLogFilePathList(isFullSync);

  if (appendResult.isErr()) {
    logger.error({ message: 'Failed to append log lines' });
    return neverthrow.err({
      code: 'APPEND_LOGS_FAILED',
      ...appendResult.error,
    } as VRChatLogFileError);
  }

  // Step 2: 保存されたログをデータベースに読み込む
  const loadResult = await loadLogInfoIndexFromVRChatLog({
    excludeOldLogLoad: !isFullSync,
  });

  if (loadResult.isErr()) {
    logger.error({ message: 'Failed to load log info' });
    return neverthrow.err(loadResult.error);
  }

  logger.info(`Log sync completed successfully with mode: ${mode}`);
  return neverthrow.ok(loadResult.value);
}

/**
 * バックグラウンド処理用のログ同期
 * 差分処理モードで実行される
 */
export async function syncLogsInBackground(): Promise<
  neverthrow.Result<LogSyncResults, VRChatLogFileError>
> {
  return syncLogs(LOG_SYNC_MODE.INCREMENTAL);
}
