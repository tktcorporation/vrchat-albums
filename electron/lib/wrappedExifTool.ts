/**
 * EXIF/XMP メタデータ操作のラッパー。
 *
 * 背景: exiftool-vendored（Perl 子プロセス）から @vrchat-albums/exif-native（Rust napi-rs）に
 * 移行中。XMP 読み取りと EXIF 書き込みは exif-native が担当する。
 *
 * @see docs/plans/exif-native-spec.md — 移行仕様書
 */

import type {
  JsExifWriteParams,
  JsVrcXmpMetadata,
} from '@vrchat-albums/exif-native';
import { Data, Effect } from 'effect';

import { logger } from './logger';

/** EXIF操作関連のエラーコード */
type ExifOperationErrorCode =
  | 'EXIF_TEMP_DIR_CREATE_FAILED'
  | 'EXIF_TEMP_FILE_WRITE_FAILED'
  | 'EXIF_WRITE_FAILED'
  | 'EXIF_TEMP_FILE_READ_FAILED'
  | 'EXIF_READ_FAILED';

/**
 * EXIF操作関連のエラー型（Data.TaggedError）
 *
 * 背景: 呼び出し側で個別コードをハンドリングする必要がないため、
 * 1クラスに code フィールドを持たせる形式。
 * Effect.catchTag("ExifOperationError", ...) で一括キャッチ可能。
 */
export class ExifOperationError extends Data.TaggedError('ExifOperationError')<{
  code: ExifOperationErrorCode;
  message: string;
  cause?: unknown;
  filePath?: string;
}> {}

// ============================================================================
// exif-native (Rust napi-rs) を遅延ロード
// ============================================================================

/**
 * exif-native モジュールの遅延ロード。
 *
 * Playwright テストとの互換性のため、トップレベルでネイティブモジュールを
 * import しない（electron-import.md ルール）。
 * 初回呼び出し時に require() で読み込む。
 */
interface ExifNativeModule {
  readVrcXmp(filePath: string): JsVrcXmpMetadata | null;
  readVrcXmpFromBuffer(buffer: Buffer): JsVrcXmpMetadata | null;
  readVrcXmpBatch(filePaths: string[]): (JsVrcXmpMetadata | null)[];
  writeExif(filePath: string, params: JsExifWriteParams): void;
  writeExifToBuffer(buffer: Buffer, params: JsExifWriteParams): Buffer;
  detectImageFormatJs(buffer: Buffer): string;
}

let _exifNative: ExifNativeModule | null = null;

const getExifNative = (): ExifNativeModule => {
  // Playwright テスト互換: トップレベル import を避け、遅延 require で読み込む
  _exifNative ??= require('@vrchat-albums/exif-native') as ExifNativeModule;
  return _exifNative;
};

// ============================================================================
// XMP 読み取り
// ============================================================================

/**
 * VRChat XMP メタデータに必要なタグだけを高速に読み取る。
 *
 * 背景: Rust ネイティブモジュールでインプロセス実行するため、
 * exiftool-vendored の子プロセス起動やタイムアウト管理が不要。
 *
 * 戻り値は exiftool-vendored の Tags 互換の Record<string, any> 形式。
 * extractOfficialMetadata() がそのまま使えるようにする。
 */
export const readXmpTags = (
  filePath: string,
): Effect.Effect<Record<string, unknown>, ExifOperationError> =>
  Effect.try({
    try: () => {
      const native = getExifNative();
      const result = native.readVrcXmp(filePath);
      if (result === null) {
        // メタデータなし: 空のオブジェクトを返す（extractOfficialMetadata が null を返す）
        return {} as Record<string, unknown>;
      }
      // exiftool-vendored の Tags 互換フォーマットに変換
      // extractOfficialMetadata が期待するキー名にマッピング
      return {
        AuthorID: result.authorId ?? undefined,
        Author: result.author ?? undefined,
        WorldID: result.worldId ?? undefined,
        WorldDisplayName: result.worldDisplayName ?? undefined,
      } as Record<string, unknown>;
    },
    catch: (error): ExifOperationError => {
      logger.debug('Failed to read XMP tags', error);
      return new ExifOperationError({
        code: 'EXIF_READ_FAILED',
        message: error instanceof Error ? error.message : String(error),
        cause: error,
        filePath,
      });
    },
  });

/**
 * ファイルパスから EXIF/XMP タグを読み取る。
 *
 * readXmpTags と同じ結果を返す（exif-native は XMP のみ読み取る）。
 */
export const readExif = async (
  filePath: string,
): Promise<Record<string, unknown>> => {
  return Effect.runPromise(readXmpTags(filePath));
};

/**
 * バッファから EXIF/XMP タグを読み取る。
 */
export const readExifByBuffer = (
  buffer: Buffer,
): Effect.Effect<Record<string, unknown>, ExifOperationError> =>
  Effect.try({
    try: () => {
      const native = getExifNative();
      const result = native.readVrcXmpFromBuffer(buffer);
      if (result === null) {
        return {} as Record<string, unknown>;
      }
      return {
        AuthorID: result.authorId ?? undefined,
        Author: result.author ?? undefined,
        WorldID: result.worldId ?? undefined,
        WorldDisplayName: result.worldDisplayName ?? undefined,
      } as Record<string, unknown>;
    },
    catch: (error): ExifOperationError => {
      logger.debug('Failed to read EXIF from buffer', error);
      return new ExifOperationError({
        code: 'EXIF_READ_FAILED',
        message: error instanceof Error ? error.message : String(error),
        cause: error,
      });
    },
  });

// ============================================================================
// EXIF 書き込み
// ============================================================================

/**
 * ファイルに EXIF メタデータ（日時・説明・タイムゾーン）を書き込む。
 *
 * World Join Image 生成時に使用。Rust ネイティブモジュールで
 * TIFF IFD を直接構築して書き込むため、一時ファイル不要。
 */
export const writeDateTimeWithTimezone = async ({
  filePath,
  description,
  dateTimeOriginal,
  timezoneOffset,
}: {
  filePath: string;
  description: string;
  dateTimeOriginal: string;
  timezoneOffset: string;
}): Promise<void> => {
  const native = getExifNative();
  native.writeExif(filePath, {
    description,
    dateTimeOriginal,
    timezoneOffset,
  });
};

/**
 * バッファに EXIF メタデータを書き込んで新しいバッファを返す。
 *
 * World Join Image のバッファに EXIF を埋め込む際に使用。
 * exiftool-vendored では一時ファイル経由だったが、Rust 実装では
 * インメモリで直接操作するため高速。
 */
export const setExifToBuffer = (
  buffer: Buffer,
  exif: {
    description: string;
    dateTimeOriginal: string;
    timezoneOffset: string;
  },
): Effect.Effect<Buffer, ExifOperationError> =>
  Effect.try({
    try: () => {
      const native = getExifNative();
      return Buffer.from(
        native.writeExifToBuffer(buffer, {
          description: exif.description,
          dateTimeOriginal: exif.dateTimeOriginal,
          timezoneOffset: exif.timezoneOffset,
        }),
      );
    },
    catch: (error): ExifOperationError => {
      logger.debug('Failed to write EXIF to buffer', error);
      return new ExifOperationError({
        code: 'EXIF_WRITE_FAILED',
        message: error instanceof Error ? error.message : String(error),
        cause: error,
      });
    },
  });

// ============================================================================
// ライフサイクル管理（exif-native では不要だが、既存の呼び出し元との互換性のため残す）
// ============================================================================

/**
 * ExifTool インスタンスのクリーンアップ。
 *
 * exif-native はインプロセスで動作するためプロセス管理が不要。
 * 既存の呼び出し元（process.on('exit') 等）との互換性のために no-op として残す。
 */
export const closeExiftoolInstance = async (): Promise<void> => {
  // exif-native はプロセス管理不要 — no-op
};
