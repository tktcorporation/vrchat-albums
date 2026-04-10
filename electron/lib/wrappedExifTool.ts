import * as nodeFs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { Data, Effect } from 'effect';
import * as exiftool from 'exiftool-vendored';
import { v4 as uuidv4 } from 'uuid';

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

import { logger } from './logger';
import * as fs from './wrappedFs';

/**
 * 非クリティカルなクリーンアップ処理
 * エラーが発生してもログのみ記録し、処理を継続
 */
const safeRmdir = async (dirPath: string): Promise<void> => {
  await nodeFs.promises.rmdir(dirPath).catch((error) => {
    logger.debug(`Failed to remove temp directory: ${dirPath}`, error);
  });
};

const safeUnlink = async (filePath: string): Promise<void> => {
  await nodeFs.promises.unlink(filePath).catch((error) => {
    logger.debug(`Failed to remove temp file: ${filePath}`, error);
  });
};

/**
 * バッファの先頭バイト（マジックバイト）から画像フォーマットの拡張子を判定する。
 *
 * 背景: exiftool はファイル拡張子と実際のフォーマットが一致しないと
 * 書き込みに失敗する。JPEG バッファを `.png` 拡張子のファイルに書き込むと
 * "Not a valid PNG" 等のエラーになるため、正しい拡張子を使う必要がある。
 */
const detectImageExtension = (buffer: Buffer): string => {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return '.jpg';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return '.png';
  }
  // フォールバック: 判定不能な場合は拡張子なし（exiftool は中身で判断可能）
  return '.bin';
};

/**
 * 一時ディレクトリとファイルパスを作成するヘルパー
 * Effect を使用して非同期エラーを型安全に処理
 *
 * @param buffer - 画像バッファ。マジックバイトから拡張子を自動判定する。
 */
const createTempFile = (
  buffer: Buffer,
): Effect.Effect<
  { tempDir: string; tempFilePath: string },
  ExifOperationError
> =>
  Effect.tryPromise({
    try: () => nodeFs.promises.mkdtemp(path.join(os.tmpdir(), 'exif-')),
    catch: (error): ExifOperationError => {
      logger.debug('Failed to create temporary directory', error);
      return new ExifOperationError({
        code: 'EXIF_TEMP_DIR_CREATE_FAILED',
        message: 'Failed to create temporary directory',
        cause: error,
      });
    },
  }).pipe(
    Effect.map((tempDir) => ({
      tempDir,
      tempFilePath: path.join(
        tempDir,
        `${uuidv4()}${detectImageExtension(buffer)}`,
      ),
    })),
  );

let exiftoolInstance: exiftool.ExifTool | null = null;

const getExiftoolInstance = async () => {
  // taskTimeoutMillis: ハングしたタスクを30秒でタイムアウトし、exiftoolプロセスを再起動する。
  // デフォルトはタイムアウトなしのため、1ファイルのハングが後続すべてのキューをブロックする。
  exiftoolInstance ??= new exiftool.ExifTool({ taskTimeoutMillis: 30_000 });
  return exiftoolInstance;
};

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
}) => {
  const exifTool = await getExiftoolInstance();

  // EXIF情報を書き込む
  await exifTool.write(filePath, {
    Description: description,
    ImageDescription: description,
    DateTimeOriginal: dateTimeOriginal,
    DateTimeDigitized: dateTimeOriginal,
    OffsetTimeOriginal: timezoneOffset,
    OffsetTime: timezoneOffset,
    OffsetTimeDigitized: timezoneOffset,
  });
};

export const setExifToBuffer = (
  buffer: Buffer,
  exif: {
    description: string;
    dateTimeOriginal: string;
    timezoneOffset: string;
  },
): Effect.Effect<Buffer, ExifOperationError> => {
  return Effect.gen(function* () {
    // Windows短縮パス問題を回避するため、一時ディレクトリを作成
    // バッファのマジックバイトから拡張子を判定し、exiftool のフォーマット不一致エラーを防ぐ
    const { tempDir, tempFilePath } = yield* createTempFile(buffer);

    // 一時ファイルに書き込み
    const writeEffect = fs.writeFileSyncSafe(
      tempFilePath,
      new Uint8Array(buffer),
    );
    const writeResult = yield* Effect.either(writeEffect);
    if (writeResult._tag === 'Left') {
      // 非クリティカルなクリーンアップ
      yield* Effect.promise(() => safeRmdir(tempDir));
      logger.debug(
        'Failed to write buffer to temporary file',
        writeResult.left,
      );
      return yield* Effect.fail(
        new ExifOperationError({
          code: 'EXIF_TEMP_FILE_WRITE_FAILED',
          message: 'Failed to write buffer to temporary file',
          cause: writeResult.left,
          filePath: tempFilePath,
        }),
      );
    }

    return yield* Effect.acquireUseRelease(
      Effect.succeed(tempFilePath),
      (tmpPath) =>
        Effect.gen(function* () {
          yield* Effect.tryPromise({
            try: () =>
              writeDateTimeWithTimezone({
                filePath: tmpPath,
                description: exif.description,
                dateTimeOriginal: exif.dateTimeOriginal,
                timezoneOffset: exif.timezoneOffset,
              }),
            catch: (error): ExifOperationError => {
              logger.debug('Failed to write EXIF data', error);
              return new ExifOperationError({
                code: 'EXIF_WRITE_FAILED',
                message: 'Failed to write EXIF data',
                cause: error,
                filePath: tmpPath,
              });
            },
          });

          // 一時ファイルを読み込み
          return yield* fs.readFileSyncSafe(tmpPath).pipe(
            Effect.mapError((readErr): ExifOperationError => {
              logger.debug('Failed to read temporary file', readErr);
              return new ExifOperationError({
                code: 'EXIF_TEMP_FILE_READ_FAILED',
                message: 'Failed to read temporary file',
                cause: readErr,
                filePath: tmpPath,
              });
            }),
          );
        }),
      (tmpPath) =>
        Effect.promise(async () => {
          // 非クリティカルなクリーンアップ
          await safeUnlink(tmpPath);
          await safeRmdir(tempDir);
        }),
    );
  });
};

/**
 * ファイルパスから EXIF/XMP タグを読み取る
 *
 * 共有の ExifTool シングルトンを使用する。
 * 呼び出し元: wrappedExifTool 内部、vrchatPhotoMetadata/service.ts
 */
export const readExif = async (filePath: string) => {
  const instance = await getExiftoolInstance();
  const exif = await instance.read(filePath);
  return exif;
};

/**
 * Promise.race 用のタイムアウト Promise とそのキャンセル関数を返すヘルパー。
 *
 * Promise.race が read 側で決着した後も setTimeout が残り続けるタイマーリークを防ぐため、
 * cancelTimeout を finally ブロックで呼び出すこと。
 */
const makeTimeoutPromise = (ms: number, label: string) => {
  let timerId: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<never>((_, reject) => {
    timerId = setTimeout(
      () => reject(new Error(`EXIF read timeout after ${ms}ms: ${label}`)),
      ms,
    );
  });
  const cancelTimeout = () => {
    if (timerId !== undefined) {
      clearTimeout(timerId);
    }
  };
  return { promise, cancelTimeout };
};

/**
 * VRChat XMP メタデータに必要なタグだけを高速に読み取る
 *
 * 背景: readExif() は全タグを読み取るが、VRChat メタデータには
 * XMP の 4 タグ (AuthorID, Author, WorldID, WorldDisplayName) しか不要。
 * `-XMP:all` 指定で XMP チャンクだけ読むため PNG ファイルで高速化が期待できる。
 *
 * タイムアウト設計:
 * - taskTimeoutMillis: 30_000 が1次タイムアウト（exiftool プロセス自動再起動）
 * - Promise.race 35_000 が2次タイムアウト（taskTimeoutMillis が発火しない場合のフォールバック）
 * - 2次タイムアウト発火時は closeExiftoolInstance() を呼び出してキューをリセットする。
 *   Promise.race は負けた側（instance.read）をキャンセルしないため、
 *   プロセス強制リセットなしではキューが積み上がり後続すべてがハングする。
 * - makeTimeoutPromise の cancelTimeout を finally で呼び出し、
 *   read が先に完了した場合のタイマーリークを防ぐ。
 */
export const readXmpTags = (
  filePath: string,
): Effect.Effect<exiftool.Tags, ExifOperationError> =>
  Effect.gen(function* () {
    const instance = yield* Effect.promise(getExiftoolInstance);
    // -fast2 は JPEG の IFD 末尾以降をスキップする最適化だが、PNG ファイルで
    // exiftool がハングする原因になることがあるため使用しない。
    const TIMEOUT_MS = 35_000;
    const { promise: timeoutPromise, cancelTimeout } = makeTimeoutPromise(
      TIMEOUT_MS,
      filePath,
    );
    return yield* Effect.tryPromise({
      try: () =>
        Promise.race([
          instance.read(filePath, ['-XMP:all']),
          timeoutPromise,
        ]).finally(cancelTimeout),
      catch: (readError): ExifOperationError => {
        // taskTimeoutMillis が発火しなかった場合（2次タイムアウト）:
        // インスタンスを強制リセットしてキューのブロックを解消する。
        // void で非同期実行（エラーを即返却し、クリーンアップはバックグラウンドで行う）
        if (
          readError instanceof Error &&
          readError.message.startsWith('EXIF read timeout')
        ) {
          void closeExiftoolInstance();
        }
        return new ExifOperationError({
          code: 'EXIF_READ_FAILED',
          message:
            readError instanceof Error ? readError.message : String(readError),
          cause: readError,
          filePath,
        });
      },
    });
  });

export const readExifByBuffer = (
  buffer: Buffer,
): Effect.Effect<exiftool.Tags, ExifOperationError> => {
  return Effect.gen(function* () {
    // Windows短縮パス問題を回避するため、一時ディレクトリを作成
    // バッファのマジックバイトから拡張子を判定し、exiftool のフォーマット不一致エラーを防ぐ
    const { tempDir, tempFilePath } = yield* createTempFile(buffer);

    // 一時ファイルに書き込み
    const writeEffect = fs.writeFileSyncSafe(
      tempFilePath,
      new Uint8Array(buffer),
    );
    const writeResult = yield* Effect.either(writeEffect);
    if (writeResult._tag === 'Left') {
      // 非クリティカルなクリーンアップ
      yield* Effect.promise(() => safeRmdir(tempDir));
      logger.debug(
        'Failed to write buffer to temporary file',
        writeResult.left,
      );
      return yield* Effect.fail(
        new ExifOperationError({
          code: 'EXIF_TEMP_FILE_WRITE_FAILED',
          message: 'Failed to write buffer to temporary file',
          cause: writeResult.left,
          filePath: tempFilePath,
        }),
      );
    }

    return yield* Effect.acquireUseRelease(
      Effect.succeed(tempFilePath),
      (tmpPath) =>
        Effect.tryPromise({
          try: () => readExif(tmpPath),
          catch: (error): ExifOperationError => {
            logger.debug('Failed to read EXIF data', error);
            return new ExifOperationError({
              code: 'EXIF_READ_FAILED',
              message: 'Failed to read EXIF data',
              cause: error,
              filePath: tmpPath,
            });
          },
        }),
      (tmpPath) =>
        Effect.promise(async () => {
          // 非クリティカルなクリーンアップ
          await safeUnlink(tmpPath);
          await safeRmdir(tempDir);
        }),
    );
  });
};

// アプリケーション終了時にExiftoolのインスタンスを終了
export const closeExiftoolInstance = async () => {
  // 先に null にセットすることで、並列呼び出し時の二重 close を防ぐ。
  // end() 自体がハングする可能性があるため .catch() で無視して回復を優先する。
  const instance = exiftoolInstance;
  exiftoolInstance = null;
  if (instance) {
    await instance.end().catch((endError) => {
      logger.debug('ExifTool shutdown failed', endError);
    });
  }
};

// 終了時のクリーンアップ処理
process.on('exit', () => void closeExiftoolInstance());
process.on('SIGINT', () => process.exit());
process.on('SIGTERM', () => process.exit());
