import * as fs from 'node:fs';

import { Transformer } from '@napi-rs/image';
import { Resvg } from '@resvg/resvg-js';
import { Effect } from 'effect';
import * as path from 'pathe';

import { withElectronApp } from '../../lib/electronModules';
import type { ImageGenerationError } from './errors';
import {
  FontLoadFailed,
  ImageConversionFailed,
  SvgRenderFailed,
} from './errors';

let fontsLoaded = false;
let cachedFontFilePaths: string[] = [];

/**
 * フォントファイルパスを解決する（初回のみ）
 *
 * 背景: resvg-js は fontFiles オプションでフォントファイルパスを受け取る。
 * Inter + Noto Sans JP をバンドルし、日本語テキストを含む SVG をレンダリング可能にする。
 *
 * フォント解決の優先順位:
 * 1. Electron パッケージ済み: process.resourcesPath/fonts/
 * 2. 開発環境: electron/resources/fonts/ (__dirname からの相対パス)
 * 3. テスト環境: 同じ相対パスで解決（withElectronApp の fallback 経由）
 */
export const loadFonts = (): Effect.Effect<string[], ImageGenerationError> => {
  if (fontsLoaded) {
    return Effect.succeed(cachedFontFilePaths);
  }

  const fontsDir = withElectronApp(
    path.join(__dirname, '../../resources/fonts'),
    (app) =>
      path.join(
        app.isPackaged
          ? process.resourcesPath
          : path.join(__dirname, '../../resources'),
        'fonts',
      ),
  );

  /**
   * ロード対象のフォントファイル名。
   * 環境によって存在するファイルが異なるため、existsSync でフィルタする。
   * - Inter: Regular/Bold/SemiBold/Medium の4ウェイト
   * - NotoSansJP: Variable weight (NotoSansJP.ttf) または個別ウェイト
   */
  const fontFileNames = [
    'Inter-Regular.ttf',
    'Inter-Bold.ttf',
    'Inter-SemiBold.ttf',
    'Inter-Medium.ttf',
    'NotoSansJP.ttf',
    'NotoSansJP-Regular.ttf',
    'NotoSansJP-Bold.ttf',
  ];

  return Effect.try({
    try: () => {
      cachedFontFilePaths = fontFileNames
        .map((f) => path.join(fontsDir, f))
        .filter((p) => fs.existsSync(p));
      // フォントが0件でもスキャン済みとしてキャッシュし、毎回の再スキャンを防ぐ
      fontsLoaded = true;
      return cachedFontFilePaths;
    },
    catch: (e): FontLoadFailed =>
      new FontLoadFailed({
        fontPath: fontsDir,
        message: e instanceof Error ? e.message : String(e),
      }),
  });
};

/**
 * SVG 文字列を PNG バッファに変換する
 *
 * 背景: Share プレビュー画像と World Join 画像の生成で使用。
 * resvg-js でラスタライズし、フォント埋め込み済みの PNG を出力する。
 * fitTo width=1600 は 800px SVG の 2x レンダリング用。
 *
 * fontFilePaths は呼び出し元(Main プロセス)が loadFonts() で事前解決して渡す。
 * resvg.render() は同期・CPU バウンドなネイティブ処理のため、この関数自体は
 * worker_threads の中で呼ばれる想定で Electron API に依存させない
 * (ADR-005: docs/adr/005-main-process-cpu-bound-worker-offload.md)。
 *
 * 呼び出し元: renderSvgToJpeg(), jobRunner.ts
 */
export const renderSvgToPng = (
  svgString: string,
  fontFilePaths: string[],
): Effect.Effect<Buffer, ImageGenerationError> =>
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
 * @param quality - JPEG 品質 (1-100)。デフォルト 85
 */
export const renderSvgToJpeg = (
  svgString: string,
  fontFilePaths: string[],
  quality = 85,
): Effect.Effect<Buffer, ImageGenerationError> =>
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
