import { Effect } from 'effect';

import { getHost, type HostUpdateCheckResult } from '../../lib/host';
import { logger } from '../../lib/logger';
import { UpdateCheckFailed } from './errors';

export interface UpdaterInfo {
  isUpdateAvailable: boolean;
  updateInfo: HostUpdateCheckResult | null;
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
    try: () => getHost().updater.checkForUpdates(),
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
      // 版の大小と配布チャンネルの判定は electron-updater に任せる。版の文字列が違うだけで
      // 更新ありとすると、beta 版を動かしているときに古い安定版を更新として表示する。
      return {
        isUpdateAvailable: updateInfo.isUpdateAvailable,
        updateInfo: updateInfo,
      };
    }),
  );
};
