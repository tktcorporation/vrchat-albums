import { app } from 'electron';
import { type UpdateCheckResult, autoUpdater } from 'electron-updater';
import { ResultAsync } from 'neverthrow';
import { logger } from '../../lib/logger';

export type UpdateCheckError = {
  type: 'UPDATE_CHECK_FAILED';
  message: string;
};

export type UpdaterInfo = {
  isUpdateAvailable: boolean;
  updateInfo: UpdateCheckResult | null;
};

/**
 * アプリのバージョン文字列を取得するユーティリティ。
 * 開発環境では package.json の値を優先する。
 */
export const getAppVersion = (): string => {
  // 本番では app.getVersion() を使用してバージョンを取得
  const appVersionDev = process.env.npm_package_version;
  if (appVersionDev !== undefined) {
    return appVersionDev;
  }

  // Electron の app.getVersion() を使用してバージョンを取得
  const appVersion = app.getVersion();

  if (!appVersion) {
    throw new Error('App version is undefined');
  }

  return appVersion;
};

/**
 * アップデートの有無と更新情報を取得する関数。
 * SettingsModal から呼び出される。
 */
export const getElectronUpdaterInfo = (): ResultAsync<
  UpdaterInfo,
  UpdateCheckError
> => {
  return ResultAsync.fromPromise(
    autoUpdater.checkForUpdates(),
    (error): UpdateCheckError => ({
      type: 'UPDATE_CHECK_FAILED',
      message:
        error instanceof Error ? error.message : 'Unknown update check error',
    }),
  ).map((updateInfo) => {
    if (!updateInfo) {
      return {
        isUpdateAvailable: false,
        updateInfo: null,
      };
    }
    logger.debug('Update info:', updateInfo);
    return {
      isUpdateAvailable: updateInfo.updateInfo.version !== app.getVersion(),
      updateInfo: updateInfo as UpdateCheckResult,
    };
  });
};

/**
 * ダウンロード済みの更新をインストールしアプリを再起動する。
 */
export const installUpdate = async (): Promise<void> => {
  const updateInfoResult = await getElectronUpdaterInfo();
  if (updateInfoResult.isErr()) {
    throw new Error(
      `Failed to check for updates: ${updateInfoResult.error.message}`,
    );
  }
  if (!updateInfoResult.value.isUpdateAvailable) {
    throw new Error('No updates available');
  }
  await autoUpdater.downloadUpdate();
  await autoUpdater.quitAndInstall();
};
