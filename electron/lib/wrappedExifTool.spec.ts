import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Transformer } from '@napi-rs/image';
import { Effect } from 'effect';
import type { ExifDateTime } from 'exiftool-vendored';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as wrappedExiftool from './wrappedExifTool';

describe('wrappedExifTool', () => {
  let testImagePath: string;
  let tempDir: string;

  beforeEach(async () => {
    // テスト用の一時ディレクトリを作成
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'exif-test-'));

    // テスト用のファイルパスを生成
    testImagePath = path.join(tempDir, 'test-image.png');

    // テスト用の画像を作成（RGBA ピクセルから PNG を生成）
    const pixels = Buffer.alloc(100 * 100 * 4, 255); // 白色 RGBA
    const pngData = await Transformer.fromRgbaPixels(pixels, 100, 100).png();
    await fs.promises.writeFile(testImagePath, pngData);
  });

  afterEach(async () => {
    // テストファイルとディレクトリを削除
    try {
      await fs.promises.unlink(testImagePath);
    } catch (_error) {
      // ファイルが既に削除されている場合は無視
    }
    try {
      await fs.promises.rmdir(tempDir);
    } catch (_error) {
      // ディレクトリが削除できない場合は無視
    }
  });

  afterAll(async () => {
    // ExifToolのインスタンスをクリーンアップ
    await wrappedExiftool.closeExiftoolInstance();
  });

  describe('writeDateTimeWithTimezone', () => {
    it('should write EXIF data to image file', async () => {
      const testData = {
        description: 'wrld_test_world',
        dateTimeOriginal: '2024-01-01 12:34:56',
        timezoneOffset: '+09:00',
      };

      // EXIFデータを書き込む
      await wrappedExiftool.writeDateTimeWithTimezone({
        filePath: testImagePath,
        ...testData,
      });

      // 書き込んだEXIFデータを読み込んで検証
      const buffer = await fs.promises.readFile(testImagePath);
      const exifData = await Effect.runPromise(
        wrappedExiftool.readExifByBuffer(buffer),
      );

      expect(exifData.Description).toBe(testData.description);
      expect(exifData.ImageDescription).toBe(testData.description);
      const dateTime = exifData.DateTimeOriginal as ExifDateTime;
      expect(dateTime.rawValue).toBe('2024:01:01 12:34:56+09:00');
    });
  });

  describe('setExifToBuffer', () => {
    it('should set EXIF data to buffer and return new buffer with EXIF', async () => {
      const testData = {
        description: 'wrld_test_world',
        dateTimeOriginal: '2024-01-01 12:34:56',
        timezoneOffset: '+09:00',
      };

      // 元の画像をバッファとして読み込む
      const originalBuffer = await fs.promises.readFile(testImagePath);

      // バッファにEXIFデータを設定
      const newBuffer = await Effect.runPromise(
        wrappedExiftool.setExifToBuffer(originalBuffer, testData),
      );

      // 新しいバッファからEXIFデータを読み込んで検証
      const exifData = await Effect.runPromise(
        wrappedExiftool.readExifByBuffer(newBuffer),
      );
      expect(exifData.Description).toBe(testData.description);
      expect(exifData.ImageDescription).toBe(testData.description);
      const dateTime = exifData.DateTimeOriginal as ExifDateTime;
      expect(dateTime.rawValue).toBe('2024:01:01 12:34:56+09:00');
    });
  });
});
