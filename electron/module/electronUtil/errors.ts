/**
 * ファイルI/O および Electron ユーティリティのエラー定義（Data.TaggedError）
 *
 * 背景: electronUtil サービスで発生するファイル操作、ダイアログ操作、
 * パス操作のエラーを 1 エラー = 1 クラスで定義する。
 *
 * @see docs/superpowers/specs/2026-03-22-effect-native-error-handling-design.md
 */

import { Data } from 'effect';

/** ファイル作成に失敗 */
export class FileCreateFailed extends Data.TaggedError('FileCreateFailed')<{
  message: string;
}> {}

/** ファイルコピーに失敗 */
export class FileCopyFailed extends Data.TaggedError('FileCopyFailed')<{
  message: string;
}> {}

/** ファイル削除に失敗 */
export class FileDeleteFailed extends Data.TaggedError('FileDeleteFailed')<{
  message: string;
}> {}

/** ファイル書き込みに失敗 */
export class FileWriteFailed extends Data.TaggedError('FileWriteFailed')<{
  message: string;
}> {}

/** 一時ディレクトリ作成に失敗 */
export class TempDirCreateFailed extends Data.TaggedError(
  'TempDirCreateFailed',
)<{
  message: string;
}> {}

/** 権限不足 */
export class PermissionDenied extends Data.TaggedError('PermissionDenied')<{
  message: string;
}> {}

/** shell.openPath() でのパスオープンに失敗 */
export class OpenPathFailed extends Data.TaggedError('OpenPathFailed')<{
  message: string;
}> {}

/** ユーザーが操作をキャンセルした（ダイアログ等） */
export class OperationCanceled extends Data.TaggedError('OperationCanceled')<{
  readonly message?: string;
}> {}

/** 画像保存に失敗 */
export class SaveFileFailed extends Data.TaggedError('SaveFileFailed')<{
  message: string;
}> {}

/** PNG 処理に失敗 */
export class PngProcessingFailed extends Data.TaggedError(
  'PngProcessingFailed',
)<{
  message: string;
}> {}

/** ファイルI/Oエラーの Union 型 */
export type FileIOError =
  | FileCreateFailed
  | FileCopyFailed
  | FileDeleteFailed
  | FileWriteFailed
  | TempDirCreateFailed
  | PermissionDenied;

/** ダウンロード画像エラーの Union 型 */
export type DownloadImageError =
  | OperationCanceled
  | SaveFileFailed
  | PngProcessingFailed;
