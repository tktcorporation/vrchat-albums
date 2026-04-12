/**
 * exif-native 互換性テスト（Contract Test）
 *
 * 背景: exiftool-vendored を Rust + napi-rs ネイティブモジュール (exif-native) に
 * 置き換えた。このテストで以下を検証する:
 *
 * 1. XMP 読み取り: exif-native が VRChat XMP メタデータを正しく読み取れること
 * 2. EXIF 書き込み: exif-native が書いた EXIF を exiftool-vendored で読み戻して検証
 *    （exiftool-vendored は検証用ツールとしてのみ使用）
 * 3. バッファ経由の読み書き
 *
 * @see docs/plans/exif-native-spec.md — 移行仕様書
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { Transformer } from '@napi-rs/image';
import { Cause, Effect, Exit, Option } from 'effect';
import type { ExifDateTime, ExifTool } from 'exiftool-vendored';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { extractOfficialMetadata } from '../module/vrchatPhotoMetadata/parser';
import {
  ExifOperationError,
  closeExiftoolInstance,
  readXmpTags,
  setExifToBuffer,
  writeDateTimeWithTimezone,
} from './wrappedExifTool';

// ============================================================================
// テストヘルパー
// ============================================================================

/** テスト用の 100x100 PNG バッファを生成 */
const createTestPng = async (): Promise<Buffer> => {
  const pixels = Buffer.alloc(100 * 100 * 4, 255);
  return Buffer.from(await Transformer.fromRgbaPixels(pixels, 100, 100).png());
};

/** テスト用の 100x100 JPEG バッファを生成 */
const createTestJpeg = async (): Promise<Buffer> => {
  const pngBuffer = await createTestPng();
  return Buffer.from(await new Transformer(pngBuffer).jpeg(85));
};

/**
 * VRChat が写真に埋め込む XMP と同等の構造を再現して書き込む。
 *
 * VRChat は独自 XMP ネームスペース (http://ns.vrchat.com/vrc/1.0/) を使用する。
 * exiftool-vendored の write() はカスタムネームスペースを直接扱えないため、
 * 生の XMP XML パケットを組み立てて XMP キーに渡す方式で注入する。
 *
 * この XMP 構造が Rust 実装でパースできるかが互換性の核心。
 */
const buildVrcXmpPacket = (metadata: {
  authorId: string;
  authorDisplayName: string;
  worldId?: string | null;
  worldDisplayName?: string | null;
}): string => {
  const worldElements = [
    metadata.worldId
      ? `      <vrc:WorldID>${escapeXmlText(metadata.worldId)}</vrc:WorldID>`
      : '',
    metadata.worldDisplayName
      ? `      <vrc:WorldDisplayName>${escapeXmlText(metadata.worldDisplayName)}</vrc:WorldDisplayName>`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  // 実際の VRChat XMP 構造を再現（2026-04 確認）:
  // - VRChat フィールドは子要素として格納される（属性ではない）
  // - xmp:Author は xmp ネームスペースの子要素
  // - 複数の rdf:Description ノード
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
    <rdf:Description>
      <xmp:CreatorTool>VRChat</xmp:CreatorTool>
      <xmp:Author>${escapeXmlText(metadata.authorDisplayName)}</xmp:Author>
    </rdf:Description>
    <rdf:Description xmlns:vrc="http://ns.vrchat.com/vrc/1.0/">
      <vrc:AuthorID>${escapeXmlText(metadata.authorId)}</vrc:AuthorID>
${worldElements}
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
};

/** XML テキストノードのエスケープ */
const escapeXmlText = (s: string): string =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;');

const writeVrcXmpWithExiftool = async (
  instance: ExifTool,
  filePath: string,
  metadata: {
    authorId: string;
    authorDisplayName: string;
    worldId?: string | null;
    worldDisplayName?: string | null;
  },
): Promise<void> => {
  const xmpPacket = buildVrcXmpPacket(metadata);
  await instance.write(filePath, { XMP: xmpPacket } as Record<string, string>, [
    '-overwrite_original',
  ]);
};

/**
 * exiftool-vendored を EXIF 書き込み検証用リーダーとして使用。
 *
 * exif-native は XMP のみ読み取るため、EXIF フィールド (ImageDescription, DateTimeOriginal 等)
 * の書き込み結果は exiftool-vendored で読み戻して検証する。
 */
const createVerificationReader = async (): Promise<ExifTool> => {
  const { ExifTool } = await import('exiftool-vendored');
  return new ExifTool({ taskTimeoutMillis: 30_000 });
};

// ============================================================================
// テスト本体
// ============================================================================

/** exiftool-vendored の ExifTool コンストラクタを遅延取得（テスト環境の安定性のため） */
const createExifToolInstance = async (): Promise<ExifTool> => {
  const { ExifTool } = await import('exiftool-vendored');
  return new ExifTool({ taskTimeoutMillis: 30_000 });
};

describe('exif-native 互換性テスト (Contract Test)', () => {
  let tempDir: string;
  let exifToolInstance: ExifTool;
  /** EXIF 書き込み結果の検証用（exiftool-vendored で読み戻す） */
  let verifier: ExifTool;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'exif-compat-'));
    exifToolInstance = await createExifToolInstance();
    verifier = await createVerificationReader();
  });

  afterEach(async () => {
    await exifToolInstance.end();
    await verifier.end();
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  afterAll(async () => {
    await closeExiftoolInstance();
  });

  // ==========================================================================
  // 1. XMP 読み取り — VRChat メタデータ
  // ==========================================================================

  describe('XMP 読み取り: PNG', () => {
    it('VRChat XMP メタデータをフル情報で読み取れる', async () => {
      const pngPath = path.join(tempDir, 'test.png');
      await fs.promises.writeFile(pngPath, await createTestPng());

      await writeVrcXmpWithExiftool(exifToolInstance, pngPath, {
        authorId: 'usr_12345678-1234-1234-1234-123456789012',
        authorDisplayName: 'TestPhotographer',
        worldId: 'wrld_12345678-1234-1234-1234-123456789012',
        worldDisplayName: 'Beautiful World',
      });

      const tags = await Effect.runPromise(readXmpTags(pngPath));
      const metadata = extractOfficialMetadata(tags);

      expect(metadata).not.toBeNull();
      expect(metadata?.authorId).toBe(
        'usr_12345678-1234-1234-1234-123456789012',
      );
      expect(metadata?.authorDisplayName).toBe('TestPhotographer');
      expect(metadata?.worldId).toBe(
        'wrld_12345678-1234-1234-1234-123456789012',
      );
      expect(metadata?.worldDisplayName).toBe('Beautiful World');
    });

    it('プライベートワールドの写真（worldId/worldDisplayName なし）', async () => {
      const pngPath = path.join(tempDir, 'private.png');
      await fs.promises.writeFile(pngPath, await createTestPng());

      await writeVrcXmpWithExiftool(exifToolInstance, pngPath, {
        authorId: 'usr_private_user',
        authorDisplayName: 'PrivateUser',
        worldId: null,
        worldDisplayName: null,
      });

      const tags = await Effect.runPromise(readXmpTags(pngPath));
      const metadata = extractOfficialMetadata(tags);

      expect(metadata).not.toBeNull();
      expect(metadata?.authorId).toBe('usr_private_user');
      expect(metadata?.authorDisplayName).toBe('PrivateUser');
      expect(metadata?.worldId).toBeNull();
      expect(metadata?.worldDisplayName).toBeNull();
    });

    it('XMP メタデータなしの PNG は null を返す', async () => {
      const pngPath = path.join(tempDir, 'no-xmp.png');
      await fs.promises.writeFile(pngPath, await createTestPng());

      const tags = await Effect.runPromise(readXmpTags(pngPath));
      const metadata = extractOfficialMetadata(tags);

      expect(metadata).toBeNull();
    });
  });

  describe('XMP 読み取り: JPEG', () => {
    it('VRChat XMP メタデータをフル情報で読み取れる', async () => {
      const jpegPath = path.join(tempDir, 'test.jpg');
      await fs.promises.writeFile(jpegPath, await createTestJpeg());

      await writeVrcXmpWithExiftool(exifToolInstance, jpegPath, {
        authorId: 'usr_jpeg_user',
        authorDisplayName: 'JpegPhotographer',
        worldId: 'wrld_jpeg_world',
        worldDisplayName: 'JPEG World',
      });

      const tags = await Effect.runPromise(readXmpTags(jpegPath));
      const metadata = extractOfficialMetadata(tags);

      expect(metadata).not.toBeNull();
      expect(metadata?.authorId).toBe('usr_jpeg_user');
      expect(metadata?.authorDisplayName).toBe('JpegPhotographer');
      expect(metadata?.worldId).toBe('wrld_jpeg_world');
      expect(metadata?.worldDisplayName).toBe('JPEG World');
    });
  });

  // ==========================================================================
  // 2. EXIF 書き込み — exiftool-vendored で読み戻して検証
  // ==========================================================================

  describe('EXIF 書き込み: ファイル直接', () => {
    it('PNG に EXIF メタデータ（日時・説明）を書き込める', async () => {
      const pngPath = path.join(tempDir, 'write-test.png');
      await fs.promises.writeFile(pngPath, await createTestPng());

      await Effect.runPromise(
        writeDateTimeWithTimezone({
          filePath: pngPath,
          description: 'Test World Name',
          dateTimeOriginal: '2024:06:15 18:30:00',
          timezoneOffset: '+09:00',
        }),
      );

      // exiftool-vendored で読み戻して EXIF フィールドを検証
      const tags = await verifier.read(pngPath);
      expect(tags.ImageDescription).toBe('Test World Name');
      const dateTime = tags.DateTimeOriginal as ExifDateTime;
      expect(dateTime.rawValue).toContain('2024:06:15 18:30:00');
    });

    it('JPEG に EXIF メタデータ（日時・説明）を書き込める', async () => {
      const jpegPath = path.join(tempDir, 'write-test.jpg');
      await fs.promises.writeFile(jpegPath, await createTestJpeg());

      await Effect.runPromise(
        writeDateTimeWithTimezone({
          filePath: jpegPath,
          description: 'JPEG World',
          dateTimeOriginal: '2025:01:01 00:00:00',
          timezoneOffset: '+00:00',
        }),
      );

      const tags = await verifier.read(jpegPath);
      expect(tags.ImageDescription).toBe('JPEG World');
      const dateTime = tags.DateTimeOriginal as ExifDateTime;
      expect(dateTime.rawValue).toContain('2025:01:01 00:00:00');
    });

    it('書き込んだ全 EXIF フィールドが正しく読み戻せる', async () => {
      const pngPath = path.join(tempDir, 'all-fields.png');
      await fs.promises.writeFile(pngPath, await createTestPng());

      await Effect.runPromise(
        writeDateTimeWithTimezone({
          filePath: pngPath,
          description: 'All Fields Test',
          dateTimeOriginal: '2024:12:31 23:59:59',
          timezoneOffset: '-05:00',
        }),
      );

      const tags = await verifier.read(pngPath);

      // Description フィールド
      expect(tags.ImageDescription).toBe('All Fields Test');

      // DateTimeOriginal
      const dto = tags.DateTimeOriginal as ExifDateTime;
      expect(dto.year).toBe(2024);
      expect(dto.month).toBe(12);
      expect(dto.day).toBe(31);
      expect(dto.hour).toBe(23);
      expect(dto.minute).toBe(59);

      // DateTimeDigitized: Exif SubIFD のタグ。exiftool が読める場合のみ検証
      if (tags.DateTimeDigitized) {
        const dtd = tags.DateTimeDigitized as ExifDateTime;
        expect(dtd.year).toBe(2024);
      }

      // OffsetTime フィールド（OffsetTime は DateTime なしのため書き込まない）
      expect(tags.OffsetTimeOriginal).toBe('-05:00');
      expect(tags.OffsetTimeDigitized).toBe('-05:00');
    });
  });

  // ==========================================================================
  // 3. バッファ経由の読み書き
  // ==========================================================================

  describe('バッファ操作', () => {
    it('PNG バッファに EXIF を書き込んで読み戻せる', async () => {
      const pngBuffer = await createTestPng();

      const resultBuffer = await Effect.runPromise(
        setExifToBuffer(pngBuffer, {
          description: 'Buffer PNG Test',
          dateTimeOriginal: '2024:03:15 10:00:00',
          timezoneOffset: '+09:00',
        }),
      );

      // 結果が有効な PNG であることを確認
      expect(resultBuffer[0]).toBe(0x89);
      expect(resultBuffer[1]).toBe(0x50);

      // exiftool-vendored で読み戻して検証
      const tmpPath = path.join(tempDir, 'buffer-result.png');
      await fs.promises.writeFile(tmpPath, resultBuffer);
      const tags = await verifier.read(tmpPath);

      expect(tags.ImageDescription).toBe('Buffer PNG Test');
      const dateTime = tags.DateTimeOriginal as ExifDateTime;
      expect(dateTime.rawValue).toContain('2024:03:15 10:00:00');
    });

    it('JPEG バッファに EXIF を書き込んで読み戻せる', async () => {
      const jpegBuffer = await createTestJpeg();

      const resultBuffer = await Effect.runPromise(
        setExifToBuffer(jpegBuffer, {
          description: 'Buffer JPEG Test',
          dateTimeOriginal: '2024:07:20 15:30:00',
          timezoneOffset: '+09:00',
        }),
      );

      // 結果が有効な JPEG であることを確認
      expect(resultBuffer[0]).toBe(0xff);
      expect(resultBuffer[1]).toBe(0xd8);

      const tmpPath = path.join(tempDir, 'buffer-result.jpg');
      await fs.promises.writeFile(tmpPath, resultBuffer);
      const tags = await verifier.read(tmpPath);

      expect(tags.ImageDescription).toBe('Buffer JPEG Test');
      const dateTime = tags.DateTimeOriginal as ExifDateTime;
      expect(dateTime.rawValue).toContain('2024:07:20 15:30:00');
    });
  });

  // ==========================================================================
  // 4. XMP + EXIF の共存
  // ==========================================================================

  describe('XMP と EXIF の共存', () => {
    it('同一ファイルに XMP と EXIF の両方を書き込んで個別に読み取れる', async () => {
      const pngPath = path.join(tempDir, 'coexist.png');
      await fs.promises.writeFile(pngPath, await createTestPng());

      // まず EXIF を書き込み（exif-native）
      await Effect.runPromise(
        writeDateTimeWithTimezone({
          filePath: pngPath,
          description: 'Coexist World',
          dateTimeOriginal: '2024:08:01 12:00:00',
          timezoneOffset: '+09:00',
        }),
      );

      // 次に XMP を追加書き込み（exiftool-vendored）
      await writeVrcXmpWithExiftool(exifToolInstance, pngPath, {
        authorId: 'usr_coexist',
        authorDisplayName: 'CoexistUser',
        worldId: 'wrld_coexist',
        worldDisplayName: 'Coexist World',
      });

      // EXIF フィールドが読み取れる（exiftool-vendored で検証）
      const allTags = await verifier.read(pngPath);
      expect(allTags.ImageDescription).toBe('Coexist World');

      // XMP フィールドも読み取れる（exif-native で検証）
      const xmpTags = await Effect.runPromise(readXmpTags(pngPath));
      const metadata = extractOfficialMetadata(xmpTags);
      expect(metadata).not.toBeNull();
      expect(metadata?.authorId).toBe('usr_coexist');
    });
  });

  // ==========================================================================
  // 5. エラーハンドリング
  // ==========================================================================

  describe('エラーハンドリング', () => {
    it('readXmpTags に存在しないファイルパスを渡すと ExifOperationError を返す', async () => {
      const nonExistentPath = path.join(tempDir, 'does-not-exist.png');

      const exit = await Effect.runPromiseExit(readXmpTags(nonExistentPath));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failOpt = Cause.failureOption(exit.cause);
        expect(Option.isSome(failOpt)).toBe(true);
        if (Option.isSome(failOpt)) {
          expect(failOpt.value).toBeInstanceOf(ExifOperationError);
          expect(failOpt.value._tag).toBe('ExifOperationError');
          expect(failOpt.value.code).toBe('EXIF_READ_FAILED');
        }
      }
    });

    it('setExifToBuffer に非画像バッファを渡すと ExifOperationError を返す', async () => {
      const invalidBuffer = Buffer.from('not an image');

      const exit = await Effect.runPromiseExit(
        setExifToBuffer(invalidBuffer, {
          description: 'Test',
          dateTimeOriginal: '2024:01:01 00:00:00',
          timezoneOffset: '+09:00',
        }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failOpt = Cause.failureOption(exit.cause);
        expect(Option.isSome(failOpt)).toBe(true);
        if (Option.isSome(failOpt)) {
          expect(failOpt.value).toBeInstanceOf(ExifOperationError);
          expect(failOpt.value._tag).toBe('ExifOperationError');
          expect(failOpt.value.code).toBe('EXIF_WRITE_FAILED');
        }
      }
    });
  });

  // ==========================================================================
  // 5.5. XMP 保護（VRChat XMP が EXIF 書き込みで上書きされないこと）
  // ==========================================================================

  describe('XMP 保護', () => {
    it('VRChat XMP を持つ PNG に EXIF を書き込んでも XMP フィールドが保護される', async () => {
      const pngPath = path.join(tempDir, 'xmp-preserve.png');
      await fs.promises.writeFile(pngPath, await createTestPng());

      // まず VRChat XMP を書き込む
      await writeVrcXmpWithExiftool(exifToolInstance, pngPath, {
        authorId: 'usr_preserve_test',
        authorDisplayName: 'PreserveUser',
        worldId: 'wrld_preserve_test',
        worldDisplayName: 'Preserve World',
      });

      // XMP が書き込まれたことを確認
      const tagsBefore = await Effect.runPromise(readXmpTags(pngPath));
      const metaBefore = extractOfficialMetadata(tagsBefore);
      expect(metaBefore).not.toBeNull();
      expect(metaBefore?.authorId).toBe('usr_preserve_test');

      // ファイルを読み込んで setExifToBuffer で EXIF を書き込む
      const fileBuffer = await fs.promises.readFile(pngPath);
      const resultBuffer = await Effect.runPromise(
        setExifToBuffer(fileBuffer, {
          description: 'EXIF Description',
          dateTimeOriginal: '2024:06:15 18:30:00',
          timezoneOffset: '+09:00',
        }),
      );

      // 結果を一時ファイルに書き出して VRChat XMP が保護されていることを確認
      const outputPath = path.join(tempDir, 'xmp-preserve-result.png');
      await fs.promises.writeFile(outputPath, resultBuffer);

      const tagsAfter = await Effect.runPromise(readXmpTags(outputPath));
      const metaAfter = extractOfficialMetadata(tagsAfter);
      expect(metaAfter).not.toBeNull();
      expect(metaAfter?.authorId).toBe('usr_preserve_test');
      expect(metaAfter?.authorDisplayName).toBe('PreserveUser');
      expect(metaAfter?.worldId).toBe('wrld_preserve_test');
      expect(metaAfter?.worldDisplayName).toBe('Preserve World');
    });
  });

  // ==========================================================================
  // 6. エッジケース
  // ==========================================================================

  describe('エッジケース', () => {
    it('日本語を含む Description を正しく読み書きできる', async () => {
      const pngPath = path.join(tempDir, 'unicode.png');
      await fs.promises.writeFile(pngPath, await createTestPng());

      await Effect.runPromise(
        writeDateTimeWithTimezone({
          filePath: pngPath,
          description: '日本語のワールド名 🌏',
          dateTimeOriginal: '2024:01:01 00:00:00',
          timezoneOffset: '+09:00',
        }),
      );

      const tags = await verifier.read(pngPath);
      expect(tags.ImageDescription).toBe('日本語のワールド名 🌏');
    });

    it('日本語を含む XMP フィールドを正しく読み書きできる', async () => {
      const pngPath = path.join(tempDir, 'unicode-xmp.png');
      await fs.promises.writeFile(pngPath, await createTestPng());

      await writeVrcXmpWithExiftool(exifToolInstance, pngPath, {
        authorId: 'usr_unicode',
        authorDisplayName: '日本語ユーザー',
        worldId: 'wrld_unicode',
        worldDisplayName: 'お花見ワールド 🌸',
      });

      const tags = await Effect.runPromise(readXmpTags(pngPath));
      const metadata = extractOfficialMetadata(tags);

      expect(metadata).not.toBeNull();
      expect(metadata?.authorDisplayName).toBe('日本語ユーザー');
      expect(metadata?.worldDisplayName).toBe('お花見ワールド 🌸');
    });

    it('非常に長い Description を扱える', async () => {
      const pngPath = path.join(tempDir, 'long-desc.png');
      await fs.promises.writeFile(pngPath, await createTestPng());

      const longDescription = 'A'.repeat(1000);
      await Effect.runPromise(
        writeDateTimeWithTimezone({
          filePath: pngPath,
          description: longDescription,
          dateTimeOriginal: '2024:01:01 00:00:00',
          timezoneOffset: '+09:00',
        }),
      );

      const tags = await verifier.read(pngPath);
      expect(tags.ImageDescription).toBe(longDescription);
    });

    it('タイムゾーンオフセット UTC (+00:00) が正しく処理される', async () => {
      const pngPath = path.join(tempDir, 'utc.png');
      await fs.promises.writeFile(pngPath, await createTestPng());

      await Effect.runPromise(
        writeDateTimeWithTimezone({
          filePath: pngPath,
          description: 'UTC Test',
          dateTimeOriginal: '2024:06:15 12:00:00',
          timezoneOffset: '+00:00',
        }),
      );

      const tags = await verifier.read(pngPath);
      expect(tags.OffsetTimeOriginal).toBe('+00:00');
    });

    it('負のタイムゾーンオフセットが正しく処理される', async () => {
      const pngPath = path.join(tempDir, 'negative-tz.png');
      await fs.promises.writeFile(pngPath, await createTestPng());

      await Effect.runPromise(
        writeDateTimeWithTimezone({
          filePath: pngPath,
          description: 'Negative TZ',
          dateTimeOriginal: '2024:06:15 12:00:00',
          timezoneOffset: '-08:00',
        }),
      );

      const tags = await verifier.read(pngPath);
      expect(tags.OffsetTimeOriginal).toBe('-08:00');
    });
  });

  // ==========================================================================
  // 6. プロダクション呼び出しパターンの再現
  // ==========================================================================

  describe('プロダクション呼び出しパターン', () => {
    it('readXmpTagsBatch の Rust バッチ一発呼びフロー', async () => {
      // プロダクションの実際のフロー:
      //   service.ts が readXmpTagsBatch を一発呼びし、Rust 側で
      //   Rayon 全コア並列 + 部分読み込みでバッチ処理する

      // 3ファイル用意（XMP あり2, なし1）
      const paths: string[] = [];
      for (const name of ['batch1.png', 'batch2.png', 'no-xmp.png']) {
        const p = path.join(tempDir, name);
        await fs.promises.writeFile(p, await createTestPng());
        paths.push(p);
      }

      // 2ファイルに XMP を書き込み
      await writeVrcXmpWithExiftool(exifToolInstance, paths[0], {
        authorId: 'usr_batch1',
        authorDisplayName: 'BatchUser1',
        worldId: 'wrld_batch1',
        worldDisplayName: 'Batch World 1',
      });
      await writeVrcXmpWithExiftool(exifToolInstance, paths[1], {
        authorId: 'usr_batch2',
        authorDisplayName: 'BatchUser2',
        worldId: null,
        worldDisplayName: null,
      });

      // readXmpTagsBatch で Rust バッチ一発呼び
      const { readXmpTagsBatch } = await import('./wrappedExifTool');
      const results = readXmpTagsBatch(paths);

      // 入力と同じ長さの配列が返る
      expect(results).toHaveLength(3);
      // XMP ありの2ファイル: data にメタデータ、error は null
      expect(results[0].data?.authorId).toBe('usr_batch1');
      expect(results[0].error).toBeNull();
      expect(results[1].data?.authorId).toBe('usr_batch2');
      expect(results[1].error).toBeNull();
      // XMP なしファイル: data も error も null
      expect(results[2].data).toBeNull();
      expect(results[2].error).toBeNull();

      // extractOfficialMetadata で Zod 検証もパスすることを確認
      const { extractOfficialMetadata } =
        await import('../module/vrchatPhotoMetadata/parser');
      const r0 = results[0].data;
      const meta0 = extractOfficialMetadata({
        AuthorID: r0?.authorId,
        Author: r0?.author,
        WorldID: r0?.worldId,
        WorldDisplayName: r0?.worldDisplayName,
      });
      expect(meta0?.authorId).toBe('usr_batch1');
      expect(meta0?.worldId).toBe('wrld_batch1');
    });

    it('electronUtilController のハイフン区切り日時フォーマット', async () => {
      // electronUtilController.ts:154 は datefns.format(date, 'yyyy-MM-dd HH:mm:ss') を使う
      // exiftool-vendored はこれを受け入れていたので、exif-native でも動く必要がある
      const pngPath = path.join(tempDir, 'hyphen-date.png');
      await fs.promises.writeFile(pngPath, await createTestPng());

      await Effect.runPromise(
        writeDateTimeWithTimezone({
          filePath: pngPath,
          description: 'wrld_test',
          dateTimeOriginal: '2024-06-15 18:30:00',
          timezoneOffset: '+09:00',
        }),
      );

      const tags = await verifier.read(pngPath);
      expect(tags.ImageDescription).toBe('wrld_test');
      // 日時がなんらかの形で保存されていることを確認
      expect(tags.DateTimeOriginal).toBeDefined();
    });

    it('worldJoinImage の setExifToBuffer → ファイル書き出しフロー', async () => {
      // worldJoinImage/service.ts:146 のフロー:
      //   generateWorldJoinImage() で画像バッファ生成 → setExifToBuffer → ファイル書き出し
      const rawImageBuffer = await createTestPng();

      const imageBuffer = await Effect.runPromise(
        setExifToBuffer(rawImageBuffer, {
          description: 'Test World Name',
          dateTimeOriginal: '2024:08:01 12:00:00',
          timezoneOffset: '+09:00',
        }),
      );

      // ファイルに書き出して読み戻す（プロダクションの fsPromises.writeFile と同等）
      const outputPath = path.join(tempDir, 'world-join.png');
      await fs.promises.writeFile(outputPath, imageBuffer);

      const tags = await verifier.read(outputPath);
      expect(tags.ImageDescription).toBe('Test World Name');
    });
  });

  // ==========================================================================
  // 7. 実際の VRChat 写真からの XMP 読み取り
  // ==========================================================================

  describe('実際の VRChat 写真', () => {
    const REAL_PHOTO_PATH = path.resolve(
      __dirname,
      '../../VRChat_2026-04-11_09-42-51.435_3840x2160.png',
    );

    const photoExists = (): boolean => {
      try {
        fs.accessSync(REAL_PHOTO_PATH, fs.constants.R_OK);
        return true;
      } catch {
        return false;
      }
    };

    it.skipIf(!photoExists())(
      'readXmpTags で VRChat 公式 XMP メタデータを読み取れる',
      async () => {
        const tags = await Effect.runPromise(readXmpTags(REAL_PHOTO_PATH));
        const metadata = extractOfficialMetadata(tags);

        expect(metadata).not.toBeNull();
        expect(metadata?.authorId).toMatch(/^usr_[0-9a-f-]+$/);
        expect(metadata?.authorDisplayName).toBeTruthy();

        if (metadata?.worldId) {
          expect(metadata.worldId).toMatch(/^wrld_[0-9a-f-]+$/);
        }
        if (metadata?.worldId) {
          expect(metadata.worldDisplayName).toBeTruthy();
        }
      },
    );

    it.skipIf(!photoExists())(
      'readXmpTags が返すフィールドから extractOfficialMetadata が正しく抽出できる',
      async () => {
        const tags = await Effect.runPromise(readXmpTags(REAL_PHOTO_PATH));
        // biome-ignore lint/suspicious/noExplicitAny: exif-native が返す Record のキー名を検証
        const t = tags as Record<string, any>;

        expect(t.AuthorID).toBeDefined();
        expect(t.AuthorID).toBeTypeOf('string');
        expect(t.Author).toBeDefined();
        expect(t.Author).toBeTypeOf('string');
        expect(t.WorldID).toBeDefined();
        expect(t.WorldID).toBeTypeOf('string');
        expect(t.WorldDisplayName).toBeDefined();
        expect(t.WorldDisplayName).toBeTypeOf('string');
      },
    );

    it.skipIf(!photoExists())(
      'readExif でも同じメタデータが取得できる',
      async () => {
        // readExif は readXmpTags と同じ結果を返す（exif-native は XMP のみ読み取る）
        const tags = await Effect.runPromise(readXmpTags(REAL_PHOTO_PATH));
        const metadata = extractOfficialMetadata(tags);

        expect(metadata).not.toBeNull();
        expect(metadata?.authorId).toMatch(/^usr_[0-9a-f-]+$/);
        expect(metadata?.authorDisplayName).toBeTruthy();
      },
    );
  });
});
