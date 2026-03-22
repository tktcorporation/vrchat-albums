/**
 * インポートサービスの Data.TaggedError 定義
 *
 * @see docs/superpowers/specs/2026-03-22-effect-native-error-handling-design.md
 */

import { Data } from 'effect';

/** インポート対象ファイルが見つからない */
export class ImportNoFilesFound extends Data.TaggedError('ImportNoFilesFound')<{
  paths: string[];
}> {}

/** インポート前バックアップに失敗 */
export class ImportBackupFailed extends Data.TaggedError('ImportBackupFailed')<{
  message: string;
}> {}

/** インポート対象ファイルが存在しない */
export class ImportFileNotFound extends Data.TaggedError('ImportFileNotFound')<{
  path: string;
}> {}

/** インポート後のDB同期に失敗 */
export class ImportDbSyncFailed extends Data.TaggedError('ImportDbSyncFailed')<{
  message: string;
}> {}

/** logStore統合に失敗 */
export class ImportLogstoreIntegrationFailed extends Data.TaggedError(
  'ImportLogstoreIntegrationFailed',
)<{
  message: string;
}> {}

/** インポートエラーの Union 型 */
export type ImportServiceError =
  | ImportNoFilesFound
  | ImportBackupFailed
  | ImportFileNotFound
  | ImportDbSyncFailed
  | ImportLogstoreIntegrationFailed;
