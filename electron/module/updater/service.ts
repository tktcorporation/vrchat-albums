/**
 * 自動アップデート機能を管理するサービス（Electrobun Updater API 版）。
 *
 * 背景: Electron 版では electron-updater を使用していた。
 * Electrobun の組み込み Updater API（bsdiff ベースの差分パッチ）に移行。
 * Updater.checkForUpdate() でサーバーに問い合わせ、
 * Updater.downloadUpdate() でパッチ適用→再起動を行う。
 *
 * @see electron/module/updater/router.ts - tRPC ルーター
 */
import { Effect } from 'effect';
import { BehaviorSubject } from 'rxjs';
import { match } from 'ts-pattern';

import { logger } from '../../lib/logger';
import { UpdateCheckFailed } from './errors';

/**
 * Electrobun Updater モジュールを遅延取得する。
 * テスト環境など Electrobun が利用不可の場合は null を返す。
 */
const getUpdater = (): {
  checkForUpdate: () => Promise<{
    updateAvailable: boolean;
    updateReady: boolean;
    version: string;
    error: string;
  }>;
  downloadUpdate: () => void;
  onStatusChange: (
    cb: (entry: { status: string; message: string }) => void,
  ) => void;
} | null => {
  // effect-lint-allow-try-catch: ランタイム環境検出パターン
  try {
    const { Updater } = require('electrobun/bun');
    return Updater;
  } catch {
    return null;
  }
};

export class UpdaterService {
  private updateDownloaded = new BehaviorSubject<boolean>(false);

  constructor() {
    const updater = getUpdater();
    if (updater) {
      updater.onStatusChange((entry) => {
        logger.debug(`[Updater] ${entry.status}: ${entry.message}`);
        match(entry.status)
          .with('complete', () => this.updateDownloaded.next(true))
          .with('error', () =>
            logger.warnWithSentry({
              message: `Update error: ${entry.message}`,
            }),
          )
          .otherwise(() => {});
      });
      logger.debug('UpdaterService initialized with Electrobun Updater API');
    } else {
      logger.debug(
        'UpdaterService initialized without Updater (non-Electrobun environment)',
      );
    }
  }

  /**
   * 更新の有無をサーバーに問い合わせる。
   * 更新があれば自動的にダウンロードを開始する。
   */
  public checkForUpdates(): Effect.Effect<void, UpdateCheckFailed> {
    const updater = getUpdater();
    if (!updater) {
      logger.debug('checkForUpdates: Updater not available');
      return Effect.void;
    }

    return Effect.tryPromise({
      try: async () => {
        const result = await updater.checkForUpdate();
        logger.info(
          `Update check result: available=${result.updateAvailable}, version=${result.version}`,
        );
        if (result.updateAvailable) {
          updater.downloadUpdate();
        }
      },
      catch: (e) =>
        new UpdateCheckFailed({
          message: e instanceof Error ? e.message : String(e),
          cause: e,
        }),
    });
  }

  /**
   * ダウンロード済みの更新を適用して再起動する。
   * Electrobun では downloadUpdate() が完了時に自動で再起動するため、
   * このメソッドは downloadUpdate() を再度呼ぶだけで良い。
   */
  public async quitAndInstall() {
    const updater = getUpdater();
    if (!updater) {
      logger.debug('quitAndInstall: Updater not available');
      return;
    }
    updater.downloadUpdate();
  }

  public getUpdateDownloaded() {
    return this.updateDownloaded.value;
  }

  public subscribeToUpdateDownloaded(callback: (downloaded: boolean) => void) {
    return this.updateDownloaded.subscribe(callback);
  }
}
