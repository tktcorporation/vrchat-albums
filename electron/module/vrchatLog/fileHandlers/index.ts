/**
 * VRChatログのファイル操作機能をまとめたモジュール
 */

// ログファイル読み込み
export {
  getLogLinesByLogFilePathList,
  getLogLinesByLogFilePathListStreaming,
  getLogLinesByLogFilePathListWithPartialSuccess,
  getLogLinesFromLogFile,
} from './logFileReader';
export type { DedupCache } from './logStorageManager';
// ログストレージ管理
export {
  appendLoglinesToFile,
  createDedupCache,
  getLegacyLogStoreFilePath,
  getLogStoreDir,
  getLogStoreFilePathForDate,
  getLogStoreFilePathsInRange,
  initLogStoreDir,
} from './logStorageManager';

// 写真からのログインポート
export { importLogLinesFromLogPhotoDirPath } from './photoLogImporter';
