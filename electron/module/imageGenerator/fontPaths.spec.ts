import * as fs from 'node:fs';

import { Effect } from 'effect';
import * as path from 'pathe';
import { describe, expect, it } from 'vitest';

import { loadFonts } from './fontPaths';

/**
 * TrueType / OpenType / TrueType Collection の先頭 4 バイト。
 * resvg は読めないフォントファイルを黙って読み飛ばして他のフォントで描くため、
 * 壊れたファイル（取得に失敗した HTML など）が混ざっても描画は失敗しない。
 * 先頭バイトを見て、フォントとして読めるファイルだけが置かれていることを確かめる。
 */
const FONT_SIGNATURES = [
  Buffer.from([0x00, 0x01, 0x00, 0x00]),
  Buffer.from('OTTO'),
  Buffer.from('true'),
  Buffer.from('ttcf'),
];

const isFontFile = (filePath: string): boolean => {
  const head = fs.readFileSync(filePath).subarray(0, 4);
  return FONT_SIGNATURES.some((signature) => signature.equals(head));
};

const BUNDLED_FONTS_DIR = path.join(__dirname, '../../resources/fonts');

describe('loadFonts', () => {
  it('日本語を描ける Noto Sans JP を解決する', async () => {
    const fontFilePaths = await Effect.runPromise(loadFonts());

    expect(
      fontFilePaths.some((p) => path.basename(p).startsWith('NotoSansJP')),
    ).toBe(true);
  });

  it('解決したファイルはすべてフォントとして読める', async () => {
    const fontFilePaths = await Effect.runPromise(loadFonts());

    expect(fontFilePaths.filter((p) => !isFontFile(p))).toStrictEqual([]);
  });
});

describe('同梱フォントのディレクトリ', () => {
  it('置かれたファイルはすべてフォントとして読める', () => {
    const files = fs
      .readdirSync(BUNDLED_FONTS_DIR)
      .map((name) => path.join(BUNDLED_FONTS_DIR, name));

    expect(files.filter((p) => !isFontFile(p))).toStrictEqual([]);
  });
});
