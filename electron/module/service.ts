import path from 'node:path';

import { Effect } from 'effect';

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

/** すべての設定値をクリアする */
export const clearAllStoredSettings = () => {
  const settingStore = getSettingStore();
  return settingStore.clearAllStoredSettings();
};
/** 指定したキーの設定を削除する */
export const clearStoredSetting = (
  key: Parameters<ReturnType<typeof getSettingStore>['clearStoredSetting']>[0],
) => {
  const settingStore = getSettingStore();
  return settingStore.clearStoredSetting(key);
};

/** OS のエクスプローラーでファイルを開く */
export const openPathOnExplorer = (filePath: string) => {
  logger.debug(`openPathOnExplorer ${filePath}`);
  return openPathInExplorer(filePath);
};

/** アプリのログフォルダをエクスプローラーで開く */
export const openElectronLogOnExplorer = () => {
  const electronLogPath = logger.electronLogFilePath;
  logger.debug(`electronLogPath ${electronLogPath}`);
  return openPathInExplorer(electronLogPath);
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
    Effect.tap((dirPath) => {
      const settingStore = getSettingStore();
      settingStore.setLogFilesDir(dirPath);
    }),
    Effect.as(void 0),
  );
};

/** 直接指定したパスをログ保存先として登録する */
export const setVRChatLogFilesDir = (logFilesDir: string) => {
  const settingStore = getSettingStore();
  settingStore.setLogFilesDir(logFilesDir);
};
