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

/**
 * 画像生成 worker (worker_threads) が異常終了した
 *
 * 背景: 画像生成は Main プロセスの応答性を保つため worker_threads 上で実行する
 * (ADR-005)。worker 側で予期しない Defect が発生した場合や worker プロセス自体が
 * クラッシュした場合、worker の 'error'/'exit' イベントとしてのみ検知できる。
 */
export class WorkerCrashed extends Data.TaggedError('WorkerCrashed')<{
  message: string;
}> {}

/** 画像生成エラーの Union 型 */
export type ImageGenerationError =
  | WorldApiFailed
  | ImageDownloadFailed
  | SvgRenderFailed
  | ImageConversionFailed
  | FontLoadFailed
  | FileWriteFailed
  | WorkerCrashed;
