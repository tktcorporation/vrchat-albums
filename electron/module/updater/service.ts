/**
 * 自動アップデート機能を管理するサービス（Electrobun 互換版）。
 *
 * 背景: Electron 版では electron-updater を使用していた。
 * Electrobun では組み込みの Updater API を使用する予定だが、
 * 移行初期段階では自動更新機能を無効化する。
 *
 * TODO: Electrobun の Updater API で実装
 *
 * @see electron/module/updater/router.ts - tRPC ルーター
 */
import { Effect } from 'effect';
import { BehaviorSubject } from 'rxjs';

import { logger } from '../../lib/logger';
import type { UpdateCheckFailed } from './errors';

export class UpdaterService {
  private updateDownloaded = new BehaviorSubject<boolean>(false);

  constructor() {
    logger.debug(
      'UpdaterService initialized (Electrobun stub - auto-update disabled)',
    );
  }

  public checkForUpdates(): Effect.Effect<void, UpdateCheckFailed> {
    // TODO: Electrobun の Updater API で実装
    logger.debug('checkForUpdates called (Electrobun stub)');
    return Effect.succeed();
  }

  public async quitAndInstall() {
    // TODO: Electrobun の Updater API で実装
    logger.debug('quitAndInstall called (Electrobun stub)');
  }

  public getUpdateDownloaded() {
    return this.updateDownloaded.value;
  }

  public subscribeToUpdateDownloaded(callback: (downloaded: boolean) => void) {
    return this.updateDownloaded.subscribe(callback);
  }
}
