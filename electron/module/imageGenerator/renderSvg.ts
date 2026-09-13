import { Transformer } from '@napi-rs/image';
import { Resvg } from '@resvg/resvg-js';
import { Effect } from 'effect';

import { ImageConversionFailed, SvgRenderFailed } from './errors';

/**
 * SVG 文字列を PNG バッファに変換する
 *
 * 背景: Share プレビュー画像と World Join 画像の生成で使用。
 * resvg-js でラスタライズし、フォント埋め込み済みの PNG を出力する。
 * fitTo width=1600 は 800px SVG の 2x レンダリング用。
 *
 * fontFilePaths は呼び出し元(Main プロセス)が fontPaths.ts の loadFonts() で
 * 事前解決して渡す。resvg.render() は同期・CPU バウンドなネイティブ処理のため、
 * このファイルは Electron API を一切 import せず、worker_threads の中でも
 * 安全に読み込める状態を保つ
 * (ADR-005: docs/adr/005-main-process-cpu-bound-worker-offload.md)。
 *
 * 呼び出し元: renderSvgToJpeg(), jobRunner.ts
 */
export const renderSvgToPng = (
  svgString: string,
  fontFilePaths: string[],
): Effect.Effect<Buffer, SvgRenderFailed> =>
  Effect.try({
    try: () => {
      const resvg = new Resvg(svgString, {
        font: {
          fontFiles: fontFilePaths,
          loadSystemFonts: false,
        },
        fitTo: { mode: 'width' as const, value: 1600 },
      });
      const pngData = resvg.render();
      return Buffer.from(pngData.asPng());
    },
    catch: (e): SvgRenderFailed =>
      new SvgRenderFailed({
        message: e instanceof Error ? e.message : String(e),
      }),
  });

/**
 * SVG 文字列を JPEG バッファに変換する（PNG 経由）
 *
 * 背景: 最終出力形式として JPEG が必要な場合に使用。
 * PNG レンダリング後に @napi-rs/image で JPEG に変換する。
 *
 * @param svgString - 変換対象の SVG 文字列
 * @param fontFilePaths - loadFonts() で事前解決したフォントファイルパス
 * @param quality - JPEG 品質 (1-100)
 */
export const renderSvgToJpeg = (
  svgString: string,
  fontFilePaths: string[],
  quality: number,
): Effect.Effect<Buffer, SvgRenderFailed | ImageConversionFailed> =>
  Effect.gen(function* () {
    const pngBuffer = yield* renderSvgToPng(svgString, fontFilePaths);

    return yield* Effect.tryPromise({
      try: () =>
        new Transformer(pngBuffer)
          .jpeg(quality)
          .then((buf) => Buffer.from(buf)),
      catch: (e): ImageConversionFailed =>
        new ImageConversionFailed({
          message: e instanceof Error ? e.message : String(e),
        }),
    });
  });
