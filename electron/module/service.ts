import path from 'node:path';

import { Effect } from 'effect';

import { logger } from './../lib/logger';
import * as utilsService from './electronUtil/service';
import { getSettingStore } from './settingStore';
import * as vrchatLogFileDirService from './vrchatLogFileDir/service';

/** @deprecated Use tagged errors from vrchatLogFileDir/errors.ts instead */
export type VRChatLogFilesDirError = 'logFilesNotFound' | 'logFileDirNotFound';

export type VRChatLogFilesDirResult = {
  storedPath: string | null;
  path: string;
};

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
  return utilsService.openPathInExplorer(filePath);
};

/** アプリのログフォルダをエクスプローラーで開く */
export const openElectronLogOnExplorer = () => {
  const electronLogPath = logger.electronLogFilePath;
  logger.debug(`electronLogPath ${electronLogPath}`);
  return utilsService.openPathInExplorer(electronLogPath);
};

/** 指定ディレクトリをエクスプローラーで開く */
export const openDirOnExplorer = (dirPath: string) => {
  const dir = path.dirname(dirPath);
  return utilsService.openPathInExplorer(dir);
};

/** ダイアログからログ保存先を設定する */
export const setVRChatLogFilesDirByDialog = (): Effect.Effect<
  void,
  Error | 'canceled'
> => {
  return utilsService.openGetDirDialog().pipe(
    Effect.map((dirPath) => {
      const settingStore = getSettingStore();
      settingStore.setLogFilesDir(dirPath);
      return undefined;
    }),
  );
};

/** 直接指定したパスをログ保存先として登録する */
export const setVRChatLogFilesDir = (logFilesDir: string) => {
  const settingStore = getSettingStore();
  settingStore.setLogFilesDir(logFilesDir);
};
