import { Transformer } from '@napi-rs/image';
import { describe, expect, it } from 'vitest';

import { extractDominantColorsFromBuffer } from './colorExtractor';

/** rgb(R, G, B) 形式の文字列パターン */
const RGB_PATTERN = /^rgb\(\d+, \d+, \d+\)$/;

describe('extractDominantColorsFromBuffer', () => {
  it('should return default colors for a white pixel image', async () => {
    // 1x1 white pixel PNG
    const whitePng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
      'base64',
    );
    const result = await extractDominantColorsFromBuffer(whitePng);
    expect(result).toHaveProperty('primary');
    expect(result).toHaveProperty('secondary');
    expect(result).toHaveProperty('accent');
    expect(result.primary).toMatch(RGB_PATTERN);
    expect(result.secondary).toMatch(RGB_PATTERN);
    expect(result.accent).toMatch(RGB_PATTERN);
  });

  it('should extract non-default colors from a colorful image', async () => {
    // 50x50 の赤い画像を @napi-rs/image で生成
    const width = 50;
    const height = 50;
    const pixels = Buffer.alloc(width * height * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 200; // R
      pixels[i + 1] = 30; // G
      pixels[i + 2] = 30; // B
      pixels[i + 3] = 255; // A
    }

    const redPng = await new Transformer(
      Transformer.fromRgbaPixels(pixels, width, height).pngSync(),
    ).png();

    const result = await extractDominantColorsFromBuffer(redPng);
    expect(result.primary).toMatch(RGB_PATTERN);
    expect(result.secondary).toMatch(RGB_PATTERN);
    expect(result.accent).toMatch(RGB_PATTERN);

    // デフォルト色（青系 hsl(240,75,60)）ではなく、赤系が抽出されることを確認
    // デフォルトの primary は rgb(51, 51, 204) 付近
    expect(result.primary).not.toBe('rgb(51, 51, 204)');
  });

  it('should return all three rgb() format strings', async () => {
    const width = 100;
    const height = 100;
    const pixels = Buffer.alloc(width * height * 4);

    // 3 色の領域を作成して複数の色相グループが検出されるようにする
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        if (y < 34) {
          // 赤
          pixels[idx] = 200;
          pixels[idx + 1] = 40;
          pixels[idx + 2] = 40;
        } else if (y < 67) {
          // 緑
          pixels[idx] = 40;
          pixels[idx + 1] = 200;
          pixels[idx + 2] = 40;
        } else {
          // 青
          pixels[idx] = 40;
          pixels[idx + 1] = 40;
          pixels[idx + 2] = 200;
        }
        pixels[idx + 3] = 255; // A
      }
    }

    const colorfulPng = await new Transformer(
      Transformer.fromRgbaPixels(pixels, width, height).pngSync(),
    ).png();

    const result = await extractDominantColorsFromBuffer(colorfulPng);

    // 3 色すべてが異なる値であること
    const colors = new Set([result.primary, result.secondary, result.accent]);
    expect(colors.size).toBe(3);
  });
});
