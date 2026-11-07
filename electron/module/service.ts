import path from 'node:path';

import { Effect } from 'effect';

import { getHost } from './../lib/host';
import { logger } from './../lib/logger';
import { openElectronDialog, openPathInExplorer } from './electronUtil/service';
import { getSettingStore } from './settingStore';
import * as vrchatLogFileDirService from './vrchatLogFileDir/service';

/**
 * VRChat ログディレクトリ検証時のエラー型
 * 'logFilesNotFound': ログファイルが存在しない
 * 'logFileDirNotFound': ログディレクトリが存在しない
 */
export type VRChatLogFilesDirError = 'logFilesNotFound' | 'logFileDirNotFound';

export interface VRChatLogFilesDirResult {
  storedPath: string | null;
  path: string;
}

/**
 * VRChat ログディレクトリ設定を取得する（Result型）
 * 設定画面や起動時の検証で使用
 */
export const getVRChatLogFilesDir = (): Effect.Effect<
  VRChatLogFilesDirResult,
  VRChatLogFilesDirError
> => {
  return vrchatLogFileDirService.getVRChatLogFileDir().pipe(
    Effect.map((result) => ({
      storedPath: result.storedPath?.value ?? null,
      path: result.path.value,
    })),
  );
};

/**
 * アプリのログフォルダをエクスプローラーで開く。
 * main の `app.log` と処理本体の `backend.log` が同じフォルダにあるので、ファイルではなくフォルダを開く。
 */
export const openElectronLogOnExplorer = () => {
  const logsDir = getHost().info.paths.logs;
  logger.debug(`logsDir ${logsDir}`);
  return openPathInExplorer(logsDir);
};

/** 指定ディレクトリをエクスプローラーで開く */
export const openDirOnExplorer = (dirPath: string) => {
  const dir = path.dirname(dirPath);
  return openPathInExplorer(dir);
};

/** ダイアログからログ保存先を設定する */
export const setVRChatLogFilesDirByDialog = (): Effect.Effect<
  void,
  Error | 'canceled'
> => {
  return openElectronDialog(['openDirectory']).pipe(
    Effect.map((paths) => paths[0]),
    Effect.tap((dirPath) =>
      Effect.sync(() => {
        const settingStore = getSettingStore();
        settingStore.setLogFilesDir(dirPath);
      }),
    ),
    Effect.as(void 0),
  );
};

/** 直接指定したパスをログ保存先として登録する */
export const setVRChatLogFilesDir = (logFilesDir: string) => {
  const settingStore = getSettingStore();
  settingStore.setLogFilesDir(logFilesDir);
};
