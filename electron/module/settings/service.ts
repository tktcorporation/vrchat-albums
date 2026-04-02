/**
 * アプリケーション設定サービス。
 *
 * 背景: Electron 版では electron-updater を使用していた。
 * Electrobun では組み込みの Updater API を使用する予定だが、
 * 移行初期段階では自動更新機能を無効化する。
 *
 * 呼び出し元: electron/trpc.ts, electron/api.ts
 */
import { Effect } from 'effect';

import { logger } from '../../lib/logger';
import type { UpdateError, UpdateCheckFailed } from './errors';
import { NoUpdateAvailable } from './errors';

export interface UpdaterInfo {
  isUpdateAvailable: boolean;
  updateInfo: null;
}

/**
 * アプリのバージョン文字列を取得するユーティリティ。
 * 開発環境では package.json の値を優先する。
 */
export const getAppVersion = (): string => {
  const appVersionDev = process.env.npm_package_version;
  if (appVersionDev !== undefined) {
    return appVersionDev;
  }

  // Electrobun 環境では package.json から直接取得
  // TODO: Electrobun の app.version API が利用可能になったら更新
  return '0.28.0';
};

/**
 * アップデートの有無と更新情報を取得する関数。
 *
 * 背景: Electrobun 移行後、自動更新は Electrobun の Updater API で実装予定。
 * 現在は常に「更新なし」を返す。
 */
export const getElectronUpdaterInfo = (): Effect.Effect<
  UpdaterInfo,
  UpdateCheckFailed
> => {
  // TODO: Electrobun の Updater API で実装
  logger.debug('Update check skipped (Electrobun migration in progress)');
  return Effect.succeed({
    isUpdateAvailable: false,
    updateInfo: null,
  });
};

/**
 * ダウンロード済みの更新をインストールしアプリを再起動する。
 *
 * 背景: Electrobun 移行後は Electrobun の Updater API で実装予定。
 */
export const installUpdate = (): Effect.Effect<void, UpdateError> => {
  // TODO: Electrobun の Updater API で実装
  return Effect.fail(
    new NoUpdateAvailable({
      message: 'Auto-update not yet available in Electrobun build',
    }),
  );
};
