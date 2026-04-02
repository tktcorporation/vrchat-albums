/**
 * アプリケーション設定サービス。
 *
 * 背景: Electron 版では electron-updater を使用していた。
 * Electrobun の組み込み Updater API に移行。
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
 * Electrobun Updater モジュールを遅延取得する。
 */
const getUpdater = (): {
  checkForUpdate: () => Promise<{
    updateAvailable: boolean;
    version: string;
    error: string;
  }>;
  downloadUpdate: () => void;
  localInfo: {
    version: () => Promise<string>;
  };
} | null => {
  // effect-lint-allow-try-catch: ランタイム環境検出パターン
  try {
    const { Updater } = require('electrobun/bun');
    return Updater;
  } catch {
    return null;
  }
};

/**
 * アプリのバージョン文字列を取得するユーティリティ。
 * 開発環境では package.json の値を優先する。
 * Electrobun 環境では Updater.localInfo.version() で取得する。
 */
export const getAppVersion = (): string => {
  const appVersionDev = process.env.npm_package_version;
  if (appVersionDev !== undefined) {
    return appVersionDev;
  }

  // Electrobun 環境では version.json から同期的に取得する。
  // Updater.localInfo.version() は非同期だが、起動時に package.json のバージョンを
  // フォールバックとして使用する。
  // effect-lint-allow-try-catch: ランタイム環境検出パターン
  try {
    const fs = require('node:fs');
    const path = require('node:path');
    const versionJsonPath = path.join(
      __dirname,
      '../../../Resources/version.json',
    );
    const versionJson = JSON.parse(fs.readFileSync(versionJsonPath, 'utf8'));
    return versionJson.version;
  } catch {
    // version.json がない場合（開発環境）は package.json から取得
    // effect-lint-allow-try-catch: ランタイム環境検出パターン
    try {
      const pkg = require('../../../package.json');
      return pkg.version;
    } catch {
      return '0.0.0';
    }
  }
};

/**
 * アップデートの有無と更新情報を取得する関数。
 * Electrobun の Updater.checkForUpdate() でサーバーに問い合わせる。
 */
export const getElectronUpdaterInfo = (): Effect.Effect<
  UpdaterInfo,
  UpdateCheckFailed
> => {
  const updater = getUpdater();
  if (!updater) {
    return Effect.succeed({ isUpdateAvailable: false, updateInfo: null });
  }

  return Effect.tryPromise({
    try: async () => {
      const result = await updater.checkForUpdate();
      logger.info(
        `Update check: available=${result.updateAvailable}, version=${result.version}`,
      );
      return {
        isUpdateAvailable: result.updateAvailable,
        updateInfo: null,
      };
    },
    catch: (e): UpdateCheckFailed => ({
      type: 'UpdateCheckFailed',
      message: e instanceof Error ? e.message : String(e),
    }),
  });
};

/**
 * ダウンロード済みの更新をインストールしアプリを再起動する。
 * Electrobun の Updater.downloadUpdate() でパッチ適用→再起動を行う。
 */
export const installUpdate = (): Effect.Effect<void, UpdateError> => {
  const updater = getUpdater();
  if (!updater) {
    return Effect.fail(
      new NoUpdateAvailable({
        message: 'Updater not available in this environment',
      }),
    );
  }

  updater.downloadUpdate();
  return Effect.succeed();
};
