/**
 * 画像生成処理で発生しうる予期されたエラー（Data.TaggedError）
 *
 * 背景: Share プレビューと World Join 画像の生成パイプラインで共通使用。
 * Effect.catchTag による型安全なハンドリングを可能にする。
 *
 * @see docs/superpowers/specs/2026-03-22-effect-native-error-handling-design.md
 */

import { Data } from 'effect';

/** VRChat API によるワールド情報取得に失敗 */
export class WorldApiFailed extends Data.TaggedError('WorldApiFailed')<{
  worldId: string;
  message: string;
}> {}

/** ワールド画像のダウンロードに失敗 */
export class ImageDownloadFailed extends Data.TaggedError(
  'ImageDownloadFailed',
)<{
  url: string;
  message: string;
}> {}

/** SVG → PNG レンダリングに失敗 */
export class SvgRenderFailed extends Data.TaggedError('SvgRenderFailed')<{
  message: string;
}> {}

/** PNG → JPEG 等の画像変換に失敗 */
export class ImageConversionFailed extends Data.TaggedError(
  'ImageConversionFailed',
)<{
  message: string;
}> {}

/** フォントファイルの読み込みに失敗 */
export class FontLoadFailed extends Data.TaggedError('FontLoadFailed')<{
  fontPath: string;
  message: string;
}> {}

/** ファイル書き込みに失敗 */
export class FileWriteFailed extends Data.TaggedError('FileWriteFailed')<{
  path: string;
  message: string;
}> {}

/** 画像生成エラーの Union 型 */
export type ImageGenerationError =
  | WorldApiFailed
  | ImageDownloadFailed
  | SvgRenderFailed
  | ImageConversionFailed
  | FontLoadFailed
  | FileWriteFailed;
