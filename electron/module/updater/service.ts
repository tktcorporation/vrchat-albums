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

/**
 * このプラットフォームでアップデートを自動でダウンロード・インストールできるか。
 *
 * macOS ビルドは署名なしの dmg だけを配布している。electron-updater の MacUpdater は
 * zip を、Squirrel.Mac はコード署名を必要とするため、macOS では自動インストールが
 * 成立しない。macOS ではダウンロードページへの誘導に切り替える。
 */
export const canAutoInstallUpdates = (
  platform: NodeJS.Platform = process.platform,
): boolean => platform !== 'darwin';

export class UpdaterService {
  private updateDownloaded = new BehaviorSubject<boolean>(false);
  private availableVersion = new BehaviorSubject<string | null>(null);

  constructor(private readonly canAutoInstall = canAutoInstallUpdates()) {
    this.initializeAutoUpdater();
  }

  private initializeAutoUpdater() {
    autoUpdater.autoDownload = this.canAutoInstall;
    autoUpdater.autoInstallOnAppQuit = this.canAutoInstall;

    autoUpdater.on('update-available', (info) => {
      this.availableVersion.next(info.version);
    });

    autoUpdater.on('update-downloaded', () => {
      this.updateDownloaded.next(true);
    });

    // ダウンロードやインストールの失敗はイベントでしか届かないため、ここでログに残す
    autoUpdater.on('error', (error) => {
      logger.warn(`アップデート処理中にエラーが発生しました: ${error.message}`);
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

  public getAvailableVersion() {
    return this.availableVersion.value;
  }

  public getCanAutoInstall() {
    return this.canAutoInstall;
  }

  public subscribeToUpdateDownloaded(callback: (downloaded: boolean) => void) {
    return this.updateDownloaded.subscribe(callback);
  }
}
