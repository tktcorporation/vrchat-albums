/**
 * 画像生成処理で発生しうる予期されたエラー
 *
 * 背景: Share プレビューと World Join 画像の生成パイプラインで共通使用。
 * 呼び出し側で ts-pattern による exhaustive ハンドリングを可能にする。
 */
export type ImageGenerationError =
  | { type: 'WORLD_API_FAILED'; worldId: string; message: string }
  | { type: 'IMAGE_DOWNLOAD_FAILED'; url: string; message: string }
  | { type: 'SVG_RENDER_FAILED'; message: string }
  | { type: 'IMAGE_CONVERSION_FAILED'; message: string }
  | { type: 'FONT_LOAD_FAILED'; fontPath: string; message: string }
  | { type: 'FILE_WRITE_FAILED'; path: string; message: string };
