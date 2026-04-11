import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { Transformer } from '@napi-rs/image';
import { Effect } from 'effect';
import type { ExifDateTime, ExifTool } from 'exiftool-vendored';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as wrappedExiftool from './wrappedExifTool';

/**
 * exiftool-vendored を EXIF 書き込み結果の検証リーダーとして使用。
 * exif-native は XMP のみ読み取るため、EXIF フィールドの検証には
 * exiftool-vendored が必要。
 */
const createVerifier = async (): Promise<ExifTool> => {
  const { ExifTool } = await import('exiftool-vendored');
  return new ExifTool({ taskTimeoutMillis: 30_000 });
};

describe('wrappedExifTool', () => {
  let testImagePath: string;
  let tempDir: string;
  let verifier: ExifTool;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'exif-test-'));
    testImagePath = path.join(tempDir, 'test-image.png');

    // テスト用の画像を作成（RGBA ピクセルから PNG を生成）
    const pixels = Buffer.alloc(100 * 100 * 4, 255); // 白色 RGBA
    const pngData = await Transformer.fromRgbaPixels(pixels, 100, 100).png();
    await fs.promises.writeFile(testImagePath, pngData);

    verifier = await createVerifier();
  });

  afterEach(async () => {
    await verifier.end();
    try {
      await fs.promises.unlink(testImagePath);
    } catch {
      // ファイルが既に削除されている場合は無視
    }
    try {
      await fs.promises.rmdir(tempDir);
    } catch {
      // ディレクトリが削除できない場合は無視
    }
  });

  afterAll(async () => {
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
      await Effect.runPromise(
        wrappedExiftool.writeDateTimeWithTimezone({
          filePath: testImagePath,
          ...testData,
        }),
      );

      // exiftool-vendored で読み戻して検証
      const exifData = await verifier.read(testImagePath);

      expect(exifData.ImageDescription).toBe(testData.description);
      const dateTime = exifData.DateTimeOriginal as ExifDateTime;
      expect(dateTime.rawValue).toContain('2024-01-01 12:34:56');
    });
  });

  describe('setExifToBuffer', () => {
    it('should set EXIF data to PNG buffer and return new buffer with EXIF', async () => {
      const testData = {
        description: 'wrld_test_world',
        dateTimeOriginal: '2024-01-01 12:34:56',
        timezoneOffset: '+09:00',
      };

      const originalBuffer = await fs.promises.readFile(testImagePath);

      // バッファにEXIFデータを設定
      const newBuffer = await Effect.runPromise(
        wrappedExiftool.setExifToBuffer(originalBuffer, testData),
      );

      // 一時ファイルに書き出して exiftool-vendored で検証
      const tmpPath = path.join(tempDir, 'buffer-result.png');
      await fs.promises.writeFile(tmpPath, newBuffer);
      const exifData = await verifier.read(tmpPath);

      expect(exifData.ImageDescription).toBe(testData.description);
      const dateTime = exifData.DateTimeOriginal as ExifDateTime;
      expect(dateTime.rawValue).toContain('2024-01-01 12:34:56');
    });

    it('should set EXIF data to JPEG buffer and return new buffer with EXIF', async () => {
      const testData = {
        description: 'wrld_jpeg_test_world',
        dateTimeOriginal: '2024-06-15 18:30:00',
        timezoneOffset: '+09:00',
      };

      // PNG バッファを JPEG に変換
      const pngBuffer = await fs.promises.readFile(testImagePath);
      const jpegBuffer = Buffer.from(await new Transformer(pngBuffer).jpeg(85));

      // JPEG バッファに EXIF データを設定
      const newBuffer = await Effect.runPromise(
        wrappedExiftool.setExifToBuffer(jpegBuffer, testData),
      );

      // 一時ファイルに書き出して exiftool-vendored で検証
      const tmpPath = path.join(tempDir, 'buffer-result.jpg');
      await fs.promises.writeFile(tmpPath, newBuffer);
      const exifData = await verifier.read(tmpPath);

      expect(exifData.ImageDescription).toBe(testData.description);
      const dateTime = exifData.DateTimeOriginal as ExifDateTime;
      expect(dateTime.rawValue).toContain('2024-06-15 18:30:00');
    });
  });
});
