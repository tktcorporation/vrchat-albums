import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ExifDateTime } from 'exiftool-vendored';
import sharp from 'sharp';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as wrappedExiftool from './wrappedExifTool';

describe('wrappedExifTool', () => {
  let testImagePath: string;
  let tempDir: string;

  beforeEach(async () => {
    // テスト用の一時ディレクトリを作成
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'exif-test-'));

    // テスト用のファイルパスを生成（短縮パスを避ける）
    testImagePath = path.join(tempDir, 'test-image.png');

    // テスト用の画像を作成
    const image = sharp({
      create: {
        width: 100,
        height: 100,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    });
    await image.png().toFile(testImagePath);

    // Windowsでファイルが確実に書き込まれるまで待機
    await new Promise((resolve) => setTimeout(resolve, 100));

    // ファイルが存在することを確認
    const exists = await fs.promises
      .access(testImagePath)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      throw new Error(`Test image file was not created: ${testImagePath}`);
    }
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
      const result = await wrappedExiftool.readExifByBuffer(buffer);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const exifData = result.value;
        expect(exifData.Description).toBe(testData.description);
        expect(exifData.ImageDescription).toBe(testData.description);
        const dateTime = exifData.DateTimeOriginal as ExifDateTime;
        expect(dateTime.rawValue).toBe('2024:01:01 12:34:56');
        expect(exifData.OffsetTimeOriginal).toBe(testData.timezoneOffset);
      }
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
      const result = await wrappedExiftool.setExifToBuffer(
        originalBuffer,
        testData,
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const newBuffer = result.value;

        // 新しいバッファからEXIFデータを読み込んで検証
        const exifResult = await wrappedExiftool.readExifByBuffer(newBuffer);
        expect(exifResult.isOk()).toBe(true);
        if (exifResult.isOk()) {
          const exifData = exifResult.value;
          expect(exifData.Description).toBe(testData.description);
          expect(exifData.ImageDescription).toBe(testData.description);
          const dateTime = exifData.DateTimeOriginal as ExifDateTime;
          expect(dateTime.rawValue).toBe('2024:01:01 12:34:56');
          expect(exifData.OffsetTimeOriginal).toBe(testData.timezoneOffset);
        }
      }
    });
  });
});
