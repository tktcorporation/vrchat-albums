import { autoUpdater } from 'electron-updater';
import { ResultAsync } from 'neverthrow';
import { BehaviorSubject } from 'rxjs';
import { logger } from '../../lib/logger';

/**
 * アップデートチェックのエラー型
 */
export type UpdateCheckError = {
  type: 'UPDATE_CHECK_FAILED';
  message: string;
  cause: unknown;
};

/**
 * Electron自動アップデート機能を管理するサービス。
 *

 * @see docs/error-handling.md - エラーハンドリング設計
 * @see electron/module/updater/router.ts - tRPCルーター
 */

export class UpdaterService {
  private updateDownloaded = new BehaviorSubject<boolean>(false);

  constructor() {
    this.initializeAutoUpdater();
  }

  private initializeAutoUpdater() {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-downloaded', () => {
      this.updateDownloaded.next(true);
    });
  }

  public checkForUpdates(): ResultAsync<void, UpdateCheckError> {
    return ResultAsync.fromPromise(autoUpdater.checkForUpdates(), (error) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`アップデートの確認中にエラーが発生しました: ${message}`);
      return {
        type: 'UPDATE_CHECK_FAILED' as const,
        message,
        cause: error,
      };
    }).map(() => undefined);
  }

  public async quitAndInstall() {
    autoUpdater.quitAndInstall();
  }

  public getUpdateDownloaded() {
    return this.updateDownloaded.value;
  }

  public subscribeToUpdateDownloaded(callback: (downloaded: boolean) => void) {
    return this.updateDownloaded.subscribe(callback);
  }
}
