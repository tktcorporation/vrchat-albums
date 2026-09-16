/**
 * VRChatログのファイル操作機能をまとめたモジュール
 */

// ログファイル読み込み
export {
  getLogLinesByLogFilePathList,
  getLogLinesByLogFilePathListStreaming,
  getLogLinesByLogFilePathListWithPartialSuccess,
} from './logFileReader';
// ログストレージ管理
export {
  appendLoglinesToFile,
  createDedupCache,
  getLegacyLogStoreFilePath,
  getLogStoreFilePathForDate,
  getLogStoreFilePathsInRange,
} from './logStorageManager';

// 写真からのログインポート
export { importLogLinesFromLogPhotoDirPath } from './photoLogImporter';
