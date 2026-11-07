import { Effect } from 'effect';
import { autoUpdater, type UpdateCheckResult } from 'electron-updater';

import { getHost } from '../../lib/host';
import { logger } from '../../lib/logger';
import { UpdateCheckFailed } from './errors';

export interface UpdaterInfo {
  isUpdateAvailable: boolean;
  updateInfo: UpdateCheckResult | null;
}

/**
 * アプリのバージョン文字列を取得するユーティリティ。
 * 開発環境では package.json の値を優先する。
 */
export const getAppVersion = (): string => {
  // 本番では殻が持つアプリのバージョンを使う
  const appVersionDev = process.env.npm_package_version;
  if (appVersionDev !== undefined) {
    return appVersionDev;
  }

  const { appVersion } = getHost().info;

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
          updateInfo.updateInfo.version !== getHost().info.appVersion,
        updateInfo: updateInfo,
      };
    }),
  );
};
