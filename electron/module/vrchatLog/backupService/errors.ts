/**
 * バックアップ・ロールバックサービスの Data.TaggedError 定義
 *
 * @see docs/superpowers/specs/2026-03-22-effect-native-error-handling-design.md
 */

import { Data } from 'effect';

// --- Backup errors ---

/** バックアップ用エクスポートに失敗 */
export class BackupExportFailed extends Data.TaggedError('BackupExportFailed')<{
  message: string;
}> {}

/** バックアップメタデータの書き込みに失敗 */
export class BackupMetadataWriteFailed extends Data.TaggedError(
  'BackupMetadataWriteFailed',
)<{
  path: string;
  message: string;
}> {}

/** バックアップメタデータの更新に失敗 */
export class BackupMetadataUpdateFailed extends Data.TaggedError(
  'BackupMetadataUpdateFailed',
)<{
  backupId: string;
  message: string;
}> {}

/** バックアップ履歴の読み込みに失敗 */
export class BackupHistoryReadFailed extends Data.TaggedError(
  'BackupHistoryReadFailed',
)<{
  message: string;
}> {}

/** 指定されたバックアップが見つからない */
export class BackupNotFound extends Data.TaggedError('BackupNotFound')<{
  backupId: string;
}> {}

/** バックアップエラーの Union 型 */
export type BackupServiceError =
  | BackupExportFailed
  | BackupMetadataWriteFailed
  | BackupMetadataUpdateFailed
  | BackupHistoryReadFailed
  | BackupNotFound;

// --- Rollback errors ---

/** ロールバック用バックアップディレクトリが見つからない */
export class RollbackBackupDirNotFound extends Data.TaggedError(
  'RollbackBackupDirNotFound',
)<{
  path: string;
}> {}

/** ロールバック用メタデータが見つからない */
export class RollbackMetadataNotFound extends Data.TaggedError(
  'RollbackMetadataNotFound',
)<{
  path: string;
}> {}

/** 有効な月別データが見つからない */
export class RollbackNoValidMonthData extends Data.TaggedError(
  'RollbackNoValidMonthData',
)<{
  path: string;
}> {}

/** ロールバックの検証に失敗 */
export class RollbackValidationFailed extends Data.TaggedError(
  'RollbackValidationFailed',
)<{
  message: string;
}> {}

/** ロールバックの復帰に失敗 */
export class RollbackRestoreFailed extends Data.TaggedError(
  'RollbackRestoreFailed',
)<{
  message: string;
}> {}

/** ロールバックでディレクトリが1つも復帰されなかった */
export class RollbackNoDirsRestored extends Data.TaggedError(
  'RollbackNoDirsRestored',
)<{
  message: string;
}> {}

/** ロールバック後のDB再構築に失敗 */
export class RollbackDbRebuildFailed extends Data.TaggedError(
  'RollbackDbRebuildFailed',
)<{
  message: string;
}> {}

/** ロールバックのトランザクションに失敗 */
export class RollbackTransactionFailed extends Data.TaggedError(
  'RollbackTransactionFailed',
)<{
  message: string;
}> {}

/** ロールバックエラーの Union 型 */
export type RollbackServiceError =
  | RollbackBackupDirNotFound
  | RollbackMetadataNotFound
  | RollbackNoValidMonthData
  | RollbackValidationFailed
  | RollbackRestoreFailed
  | RollbackNoDirsRestored
  | RollbackDbRebuildFailed
  | RollbackTransactionFailed;
