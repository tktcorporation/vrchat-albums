import * as fs from 'node:fs';

import { Effect } from 'effect';
import * as path from 'pathe';

import { getHost } from '../../lib/host';
import { FontLoadFailed } from './errors';

let fontsLoaded = false;
let cachedFontFilePaths: string[] = [];

/**
 * フォントファイルパスを解決する（初回のみ）
 *
 * 背景: resvg-js は fontFiles オプションでフォントファイルパスを受け取る。
 * Noto Sans JP をバンドルし、日本語テキストを含む SVG をレンダリング可能にする。
 *
 * 殻の情報（`getHost()`）に依存するため Main プロセス側でのみ呼び出す。
 * renderSvg.ts の worker-safe な関数群とはあえて別ファイルに分離し、
 * 「worker からは決して import されない」というモジュール境界を構造的に保証する
 * (ADR-005: docs/adr/005-main-process-cpu-bound-worker-offload.md)。
 *
 * フォントは殻の同梱リソースのディレクトリ（`HostInfo.resourcesPath`）の fonts/ から読む。
 * パッケージ時と開発時の場所の違いは殻が吸収する。
 */
export const loadFonts = (): Effect.Effect<string[], FontLoadFailed> => {
  if (fontsLoaded) {
    return Effect.succeed(cachedFontFilePaths);
  }

  const fontsDir = path.join(getHost().info.resourcesPath, 'fonts');

  /**
   * ロード対象のフォントファイル名。
   * 環境によって存在するファイルが異なるため、existsSync でフィルタする。
   * NotoSansJP は Variable weight (NotoSansJP.ttf) または個別ウェイトのどちらかを置く。
   */
  const fontFileNames = [
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
