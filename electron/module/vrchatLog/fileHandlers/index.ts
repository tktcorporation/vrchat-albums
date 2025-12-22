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

// ログストレージ管理
export {
  appendLoglinesToFile,
  getLegacyLogStoreFilePath,
  getLogStoreDir,
  getLogStoreFilePathForDate,
  getLogStoreFilePathsInRange,
  initLogStoreDir,
} from './logStorageManager';

// 写真からのログインポート
export { importLogLinesFromLogPhotoDirPath } from './photoLogImporter';
