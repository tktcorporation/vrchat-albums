/**
 * EXIF/XMP メタデータ操作のラッパー。
 *
 * 背景: exiftool-vendored（Perl 子プロセス）から @vrchat-albums/exif-native（Rust napi-rs）に
 * 移行。XMP 読み取りと EXIF 書き込みは exif-native が担当する。
 *
 * @see docs/plans/exif-native-spec.md — 移行仕様書
 */

import type {
  JsExifWriteParams,
  JsImageDimensions,
  JsVrcXmpBatchResult,
  JsVrcXmpMetadata,
} from '@vrchat-albums/exif-native';
import { Data, Effect } from 'effect';

import { logger } from './logger';

/** EXIF操作関連のエラーコード */
type ExifOperationErrorCode = 'EXIF_WRITE_FAILED' | 'EXIF_READ_FAILED';

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
  readVrcXmpBatch(filePaths: string[]): JsVrcXmpBatchResult[];
  writeExif(filePath: string, params: JsExifWriteParams): void;
  writeExifToBuffer(buffer: Buffer, params: JsExifWriteParams): Buffer;
  detectImageFormatJs(buffer: Buffer): string;
  readImageDimensions(filePath: string): JsImageDimensions | null;
  readImageDimensionsBatch(
    filePaths: string[],
  ): (JsImageDimensions | null | undefined)[];
}

let _exifNative: ExifNativeModule | null = null;
/** require() の失敗メッセージをキャッシュして、繰り返し require するのを防ぐ */
let _exifNativeErrorMessage: string | null = null;

const getExifNative = (): ExifNativeModule => {
  // 前回の require() 失敗をキャッシュ済みなら即座に再スロー
  if (_exifNativeErrorMessage) {
    throw new Error(_exifNativeErrorMessage);
  }
  if (_exifNative) {
    return _exifNative;
  }
  // effect-lint-allow-try-catch: Electron 環境検出パターン（遅延 require のキャッシュ）
  try {
    // Playwright テスト互換: トップレベル import を避け、遅延 require で読み込む
    _exifNative = require('@vrchat-albums/exif-native') as ExifNativeModule;
    return _exifNative;
  } catch (error) {
    _exifNativeErrorMessage =
      error instanceof Error ? error.message : String(error);
    throw new Error(_exifNativeErrorMessage, { cause: error });
  }
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
 * 複数ファイルから VRChat XMP メタデータをバッチ読み取り。
 *
 * 背景: 従来は readXmpTags を1ファイルずつ N 回呼んでいたが、
 * Rust 側の readVrcXmpBatch は Rayon 全コア並列 + 部分読み込みで処理する。
 * N-API 境界の往復を 1 回に削減し、I/O もファイル先頭の���ッダーだけ読む。
 *
 * 戻り値は入力と同じ長さの JsVrcXmpBatchResult 配列。
 * エラーと「XMP なし」を区別できる:
 * - data あり, error null → XMP 抽出成功
 * - data null, error null → XMP が存在しない（正常）
 * - data null, error あり → I/O エラー等
 *
 * 呼び出し元: extractAndSaveMetadataBatch (vrchatPhotoMetadata/service.ts)
 */
export const readXmpTagsBatch = (
  filePaths: string[],
): JsVrcXmpBatchResult[] => {
  const native = getExifNative();
  return native.readVrcXmpBatch(filePaths);
};

// ============================================================================
// EXIF 書き込み
// ============================================================================

/**
 * ファイルに EXIF メタデータ（日時・説明・タイムゾーン）を書き込む。
 *
 * World Join Image 生成時に使用。Rust ネイティブモジュールで
 * TIFF IFD を直接構築して書き込むため、一時ファイル不要。
 */
export const writeDateTimeWithTimezone = (params: {
  filePath: string;
  description: string;
  dateTimeOriginal: string;
  timezoneOffset: string;
}): Effect.Effect<void, ExifOperationError> =>
  Effect.try({
    try: () => {
      const native = getExifNative();
      native.writeExif(params.filePath, {
        description: params.description,
        dateTimeOriginal: params.dateTimeOriginal,
        timezoneOffset: params.timezoneOffset,
      });
    },
    catch: (error): ExifOperationError => {
      logger.debug('Failed to write EXIF data', error);
      return new ExifOperationError({
        code: 'EXIF_WRITE_FAILED',
        message: error instanceof Error ? error.message : String(error),
        cause: error,
        filePath: params.filePath,
      });
    },
  });

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
// 画像サイズ取得
// ============================================================================

/**
 * 複数ファイルから画像サイズ（width/height）をバッチ読み取り。
 *
 * 背景: 写真インデックスでは width/height だけが必要だが、
 * 従来は @napi-rs/image の Transformer でファイル全体をデコードしていた。
 * Rust ネイティブモジュールでファイルの先頭バイトだけを読み取り、
 * Rayon でスレッドプール並列化することで 10〜50 倍の高速化を実現する。
 *
 * 呼び出し元: processPhotoBatch() (vrchatPhoto.service.ts)
 */
export const readImageDimensionsBatch = (
  filePaths: string[],
): (JsImageDimensions | null | undefined)[] => {
  const native = getExifNative();
  return native.readImageDimensionsBatch(filePaths);
};

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
