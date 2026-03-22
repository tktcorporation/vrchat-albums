/**
 * エクスポートサービスの Data.TaggedError 定義
 *
 * @see docs/superpowers/specs/2026-03-22-effect-native-error-handling-design.md
 */

import { Data } from 'effect';

/** エクスポート先ディレクトリの作成に失敗 */
export class ExportDirCreateFailed extends Data.TaggedError(
  'ExportDirCreateFailed',
)<{
  path: string;
  message: string;
}> {}

/** エクスポートファイルの書き込みに失敗 */
export class ExportFileWriteFailed extends Data.TaggedError(
  'ExportFileWriteFailed',
)<{
  path: string;
  message: string;
}> {}

/** エクスポート用のDBクエリに失敗 */
export class ExportDbQueryFailed extends Data.TaggedError(
  'ExportDbQueryFailed',
)<{
  message: string;
}> {}

/** エクスポートエラーの Union 型 */
export type ExportServiceError =
  | ExportDirCreateFailed
  | ExportFileWriteFailed
  | ExportDbQueryFailed;
