/**
 * 設定・アップデート関連のエラー定義（Data.TaggedError）
 *
 * 背景: settings サービスでのアップデートチェック、ダウンロード、
 * インストール時のエラーを 1 エラー = 1 クラスで定義する。
 *
 * @see docs/superpowers/specs/2026-03-22-effect-native-error-handling-design.md
 */

import { Data } from 'effect';

/** アップデートが利用できない */
export class NoUpdateAvailable extends Data.TaggedError('NoUpdateAvailable')<{
  message: string;
}> {}

/** アップデートチェックに失敗 */
export class UpdateCheckFailed extends Data.TaggedError('UpdateCheckFailed')<{
  message: string;
}> {}

/** アップデートのダウンロードに失敗 */
export class DownloadFailed extends Data.TaggedError('DownloadFailed')<{
  message: string;
}> {}

/** アップデートのインストールに失敗 */
export class InstallFailed extends Data.TaggedError('InstallFailed')<{
  message: string;
}> {}

/** アップデートエラーの Union 型 */
export type UpdateError =
  | NoUpdateAvailable
  | UpdateCheckFailed
  | DownloadFailed
  | InstallFailed;
