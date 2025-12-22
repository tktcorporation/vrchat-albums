import path from 'node:path';
import type * as neverthrow from 'neverthrow';
import type { ResultAsync } from 'neverthrow';
import { logger } from './../lib/logger';
// import * as infoFileService from './joinLogInfoFile/service';
// import { getToCreateWorldJoinLogInfos } from './joinLogInfoFile/service';
// import { YearMonthPathNotFoundError } from './service/error';
// import { PhotoFileNameSchema, parsePhotoFileName } from './service/type';
import * as utilsService from './electronUtil/service';
// import type VRChatPhotoFileError from './service/vrchatPhoto/error';
// import * as vrchatPhotoService from './service/vrchatPhoto/service';
import { getSettingStore } from './settingStore';
// import * as vrchatLogService from './service/vrchatLog/vrchatLog';
import * as vrchatLogFileDirService from './vrchatLogFileDir/service';
// import type VRChatLogFileError from './vrchatLog/error';

export type VRChatLogFilesDirError = 'logFilesNotFound' | 'logFileDirNotFound';

export type VRChatLogFilesDirResult = {
  storedPath: string | null;
  path: string;
};

/**
 * VRChat ログディレクトリ設定を取得する（Result型）
 * 設定画面や起動時の検証で使用
 */
export const getVRChatLogFilesDir = (): ResultAsync<
  VRChatLogFilesDirResult,
  VRChatLogFilesDirError
> => {
  return vrchatLogFileDirService.getVRChatLogFileDir().map((result) => ({
    storedPath: result.storedPath?.value ?? null,
    path: result.path.value,
  }));
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
export const openElectronLogOnExplorer = async () => {
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
export const setVRChatLogFilesDirByDialog = async (): Promise<
  neverthrow.Result<void, Error | 'canceled'>
> => {
  const settingStore = getSettingStore();
  return (await utilsService.openGetDirDialog()).map((dirPath) => {
    settingStore.setLogFilesDir(dirPath);
    return undefined;
  });
};

/** 直接指定したパスをログ保存先として登録する */
export const setVRChatLogFilesDir = (logFilesDir: string) => {
  const settingStore = getSettingStore();
  settingStore.setLogFilesDir(logFilesDir);
};
