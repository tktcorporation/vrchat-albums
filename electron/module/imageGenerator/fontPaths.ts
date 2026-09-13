import * as fs from 'node:fs';

import { Effect } from 'effect';
import * as path from 'pathe';

import { withElectronApp } from '../../lib/electronModules';
import { FontLoadFailed } from './errors';

let fontsLoaded = false;
let cachedFontFilePaths: string[] = [];

/**
 * フォントファイルパスを解決する（初回のみ）
 *
 * 背景: resvg-js は fontFiles オプションでフォントファイルパスを受け取る。
 * Inter + Noto Sans JP をバンドルし、日本語テキストを含む SVG をレンダリング可能にする。
 *
 * Electron API (`app.isPackaged` 等) に依存するため Main プロセス側でのみ呼び出す。
 * renderSvg.ts の worker-safe な関数群とはあえて別ファイルに分離し、
 * 「worker からは決して import されない」というモジュール境界を構造的に保証する
 * (ADR-005: docs/adr/005-main-process-cpu-bound-worker-offload.md)。
 *
 * フォント解決の優先順位:
 * 1. Electron パッケージ済み: process.resourcesPath/fonts/
 * 2. 開発環境: electron/resources/fonts/ (__dirname からの相対パス)
 * 3. テスト環境: 同じ相対パスで解決（withElectronApp の fallback 経由）
 */
export const loadFonts = (): Effect.Effect<string[], FontLoadFailed> => {
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
