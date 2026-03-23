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
 * 一時ディレクトリとファイルパスを作成するヘルパー
 * Effect を使用して非同期エラーを型安全に処理
 */
const createTempFile = (): Effect.Effect<
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
      tempFilePath: path.join(tempDir, `${uuidv4()}.png`),
    })),
  );

let exiftoolInstance: exiftool.ExifTool | null = null;

const getExiftoolInstance = async () => {
  if (!exiftoolInstance) {
    exiftoolInstance = new exiftool.ExifTool();
  }
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
    const { tempDir, tempFilePath } = yield* createTempFile();

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
  const exiftool = await getExiftoolInstance();
  const exif = await exiftool.read(filePath);
  return exif;
};

export const readExifByBuffer = (
  buffer: Buffer,
): Effect.Effect<exiftool.Tags, ExifOperationError> => {
  return Effect.gen(function* () {
    // Windows短縮パス問題を回避するため、一時ディレクトリを作成
    const { tempDir, tempFilePath } = yield* createTempFile();

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
  if (exiftoolInstance) {
    await exiftoolInstance.end();
    exiftoolInstance = null;
  }
};

// 終了時のクリーンアップ処理
process.on('exit', () => void closeExiftoolInstance());
process.on('SIGINT', () => process.exit());
process.on('SIGTERM', () => process.exit());
