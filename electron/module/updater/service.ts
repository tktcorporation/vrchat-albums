import { Effect } from 'effect';
import { autoUpdater } from 'electron-updater';
import { BehaviorSubject } from 'rxjs';

import { logger } from '../../lib/logger';
import { UpdateCheckFailed } from './errors';

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

  public checkForUpdates(): Effect.Effect<void, UpdateCheckFailed> {
    return Effect.tryPromise({
      try: () => autoUpdater.checkForUpdates(),
      catch: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`アップデートの確認中にエラーが発生しました: ${message}`);
        return new UpdateCheckFailed({ message, cause: error });
      },
    }).pipe(Effect.asVoid);
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
