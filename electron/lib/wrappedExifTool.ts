/**
 * EXIF/XMP メタデータ操作のラッパー。
 *
 * XMP 読み取りと EXIF 書き込みは @vrchat-albums/exif-native（Rust napi-rs）が同じプロセス内で行う。
 * 子プロセスを使わないので、その起動・IPC・ハング時の再起動といったプロセス管理を持たずに済む。
 *
 * ファイルへの書き込み（writeDateTimeWithTimezone）だけは、クラッシュ時に元の写真を壊さないよう
 * exif-native が同じディレクトリの一時ファイルに書いてから rename する。
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
  /** AsyncTask を返すため JS 側では Promise になる */
  readVrcXmpBatch(filePaths: string[]): Promise<JsVrcXmpBatchResult[]>;
  writeExif(filePath: string, params: JsExifWriteParams): void;
  writeExifToBuffer(buffer: Buffer, params: JsExifWriteParams): Buffer;
  detectImageFormatJs(buffer: Buffer): string;
  readImageDimensions(filePath: string): JsImageDimensions | null;
  /** AsyncTask を返すため JS 側では Promise になる */
  readImageDimensionsBatch(
    filePaths: string[],
  ): Promise<(JsImageDimensions | null | undefined)[]>;
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
 * 1 ファイルから VRChat XMP メタデータを読み取る。
 *
 * 戻り値は exif-native の JsVrcXmpMetadata をそのまま返し、
 * extractOfficialMetadata() に渡せば VRChatPhotoMetadata へパースできる。
 * VRChat メタデータを持たない写真では null を返す。
 */
export const readXmpTags = (
  filePath: string,
): Effect.Effect<JsVrcXmpMetadata | null, ExifOperationError> =>
  Effect.try({
    try: () => getExifNative().readVrcXmp(filePath),
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
 * 背景: Rust 側の readVrcXmpBatch は Rayon 全コア並列 + 部分読み込みで処理する。
 * AsyncTask で libuv スレッドプール上で実行されるため、
 * メインスレッドをブロックせず Electron の UI がフリーズしない。
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
): Promise<JsVrcXmpBatchResult[]> => {
  const native = getExifNative();
  return native.readVrcXmpBatch(filePaths);
};

// ============================================================================
// EXIF 書き込み
// ============================================================================

/**
 * ファイルに EXIF メタデータ（日時・説明・タイムゾーン）を書き込む。
 *
 * World Join Image 生成時に使用。Rust ネイティブモジュールが TIFF IFD を直接構築する。
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
 * 一時ファイルを介さず、メモリ上で新しいバッファを組み立てて返す（引数のバッファは変更しない）。
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
 * 背景: Rust ネイティブモジュールでファイルの先頭バイトだけを部分読み込みし、
 * Rayon でスレッドプール並列化する。AsyncTask で libuv スレッドプール上で
 * 実行されるため、メインスレッドをブロックしない。
 *
 * 呼び出し元: processPhotoBatch() (vrchatPhoto.service.ts)
 */
export const readImageDimensionsBatch = (
  filePaths: string[],
): Promise<(JsImageDimensions | null | undefined)[]> => {
  const native = getExifNative();
  return native.readImageDimensionsBatch(filePaths);
};
