import { Effect } from 'effect';

import { getHost } from '../../lib/host';
import { logger } from '../../lib/logger';
import { UpdateCheckFailed } from './errors';

/**
 * アプリの自動更新を、殻の更新（`getHost().updater`）へつなぐサービス。
 *
 * 更新の状態は殻が electron-updater のイベントから組み立てて持つ。ここは確認の失敗を
 * ログに残して型付きのエラーへ分類し、ルーターへ渡す。
 *
 * @see docs/error-handling.md - エラーハンドリング設計
 * @see electron/module/updater/router.ts - tRPCルーター
 * @see electron/lib/host/electronUpdater.ts - 殻の実装
 */

export const checkForUpdates = (): Effect.Effect<void, UpdateCheckFailed> =>
  Effect.tryPromise({
    try: () => getHost().updater.checkForUpdates(),
    catch: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`アップデートの確認中にエラーが発生しました: ${message}`);
      return new UpdateCheckFailed({ message, cause: error });
    },
  }).pipe(Effect.asVoid);

export const quitAndInstall = (): Promise<void> =>
  getHost().updater.quitAndInstall();

export const getUpdateStatus = () => getHost().updater.getStatus();
