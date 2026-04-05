import { Effect } from 'effect';
import { autoUpdater, type UpdateCheckResult } from 'electron-updater';

import { getApp } from '../../lib/electronModules';
import { logger } from '../../lib/logger';
import type { UpdateError } from './errors';
import { DownloadFailed, NoUpdateAvailable, UpdateCheckFailed } from './errors';

export interface UpdaterInfo {
  isUpdateAvailable: boolean;
  updateInfo: UpdateCheckResult | null;
}

/**
 * アプリのバージョン文字列を取得するユーティリティ。
 * 開発環境では package.json の値を優先する。
 */
export const getAppVersion = (): string => {
  // 本番では getApp().getVersion() を使用してバージョンを取得
  const appVersionDev = process.env.npm_package_version;
  if (appVersionDev !== undefined) {
    return appVersionDev;
  }

  // Electron の getApp().getVersion() を使用してバージョンを取得
  const appVersion = getApp().getVersion();

  if (!appVersion) {
    throw new Error('App version is undefined');
  }

  return appVersion;
};

/**
 * アップデートの有無と更新情報を取得する関数。
 * SettingsModal から呼び出される。
 */
export const getElectronUpdaterInfo = (): Effect.Effect<
  UpdaterInfo,
  UpdateCheckFailed
> => {
  return Effect.tryPromise({
    try: () => autoUpdater.checkForUpdates(),
    catch: (error): UpdateCheckFailed =>
      new UpdateCheckFailed({
        message:
          error instanceof Error ? error.message : 'Unknown update check error',
      }),
  }).pipe(
    Effect.map((updateInfo) => {
      if (!updateInfo) {
        return {
          isUpdateAvailable: false,
          updateInfo: null,
        };
      }
      logger.debug('Update info:', updateInfo);
      return {
        isUpdateAvailable:
          updateInfo.updateInfo.version !== getApp().getVersion(),
        updateInfo: updateInfo,
      };
    }),
  );
};

/**
 * ダウンロード済みの更新をインストールしアプリを再起動する。
 */
export const installUpdate = (): Effect.Effect<void, UpdateError> => {
  return getElectronUpdaterInfo().pipe(
    Effect.flatMap((updateInfo) => {
      if (!updateInfo.isUpdateAvailable) {
        return Effect.fail(
          new NoUpdateAvailable({
            message: 'No update available',
          }),
        );
      }
      return Effect.succeed(updateInfo);
    }),
    Effect.flatMap(() =>
      Effect.tryPromise({
        try: () => autoUpdater.downloadUpdate(),
        catch: (error) =>
          new DownloadFailed({
            message: error instanceof Error ? error.message : String(error),
          }),
      }),
    ),
    Effect.tap(() => {
      // quitAndInstall は void を返すので、同期的に呼び出し
      autoUpdater.quitAndInstall();
    }),
    Effect.map(() => undefined),
  );
};
