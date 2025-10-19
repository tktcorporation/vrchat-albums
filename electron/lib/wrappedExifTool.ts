import * as nodeFs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as exiftool from 'exiftool-vendored';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';
import { v4 as uuidv4 } from 'uuid';
import type { ExifOperationError } from './errorHelpers';
import { logger } from './logger';
import * as fs from './wrappedFs';

let exiftoolInstance: exiftool.ExifTool | null = null;

const getExiftoolInstance = async () => {
  if (!exiftoolInstance) {
    exiftoolInstance = new exiftool.ExifTool();
  }
  return exiftoolInstance;
};

// 共通のクリーンアップ関数
const cleanupTempFiles = async (
  tempFilePath: string,
  tempDir: string,
): Promise<void> => {
  try {
    await nodeFs.promises.unlink(tempFilePath);
  } catch (error) {
    logger.debug(`Failed to remove temp file: ${tempFilePath}`, error);
  }
  try {
    await nodeFs.promises.rmdir(tempDir);
  } catch (error) {
    logger.debug(`Failed to remove temp directory: ${tempDir}`, error);
  }
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

export const setExifToBuffer = async (
  buffer: Buffer,
  exif: {
    description: string;
    dateTimeOriginal: string;
    timezoneOffset: string;
  },
): Promise<Result<Buffer, ExifOperationError>> => {
  // Windows短縮パス問題を回避するため、一時ディレクトリを作成
  let tempDir: string;
  let tempFilePath: string;

  try {
    tempDir = await nodeFs.promises.mkdtemp(path.join(os.tmpdir(), 'exif-'));
    tempFilePath = path.join(tempDir, `${uuidv4()}.png`);
  } catch (error) {
    logger.debug('Failed to create temporary directory', error);
    return err({
      code: 'EXIF_TEMP_DIR_CREATE_FAILED',
      message: 'Failed to create temporary directory',
      cause: error,
    });
  }

  // 一時ファイルに書き込み
  const write_r = fs.writeFileSyncSafe(tempFilePath, new Uint8Array(buffer));
  if (write_r.isErr()) {
    // クリーンアップ
    try {
      await nodeFs.promises.rmdir(tempDir);
    } catch (error) {
      logger.debug(`Failed to remove temp directory: ${tempDir}`, error);
      // Non-critical error, continue
    }
    logger.debug('Failed to write buffer to temporary file', write_r.error);
    return err({
      code: 'EXIF_TEMP_FILE_WRITE_FAILED',
      message: 'Failed to write buffer to temporary file',
      cause: write_r.error,
      filePath: tempFilePath,
    });
  }

  try {
    await writeDateTimeWithTimezone({
      filePath: tempFilePath,
      description: exif.description,
      dateTimeOriginal: exif.dateTimeOriginal,
      timezoneOffset: exif.timezoneOffset,
    });

    // 一時ファイルを読み込み
    const read_r = fs.readFileSyncSafe(tempFilePath);
    if (read_r.isErr()) {
      logger.debug('Failed to read temporary file', read_r.error);
      return err({
        code: 'EXIF_TEMP_FILE_READ_FAILED',
        message: 'Failed to read temporary file',
        cause: read_r.error,
        filePath: tempFilePath,
      });
    }

    return ok(read_r.value);
  } catch (error) {
    logger.debug('Failed to write EXIF data', error);
    return err({
      code: 'EXIF_WRITE_FAILED',
      message: 'Failed to write EXIF data',
      cause: error,
      filePath: tempFilePath,
    });
  } finally {
    // クリーンアップ処理を統合
    await cleanupTempFiles(tempFilePath, tempDir);
  }
};

const readExif = async (filePath: string) => {
  const exiftool = await getExiftoolInstance();
  const exif = await exiftool.read(filePath);
  return exif;
};

export const readExifByBuffer = async (
  buffer: Buffer,
): Promise<Result<exiftool.Tags, ExifOperationError>> => {
  // Windows短縮パス問題を回避するため、一時ディレクトリを作成
  let tempDir: string;
  let tempFilePath: string;

  try {
    tempDir = await nodeFs.promises.mkdtemp(path.join(os.tmpdir(), 'exif-'));
    tempFilePath = path.join(tempDir, `${uuidv4()}.png`);
  } catch (error) {
    logger.debug('Failed to create temporary directory', error);
    return err({
      code: 'EXIF_TEMP_DIR_CREATE_FAILED',
      message: 'Failed to create temporary directory',
      cause: error,
    });
  }

  // 一時ファイルに書き込み
  const write_r = fs.writeFileSyncSafe(tempFilePath, new Uint8Array(buffer));
  if (write_r.isErr()) {
    // クリーンアップ
    try {
      await nodeFs.promises.rmdir(tempDir);
    } catch (error) {
      logger.debug(`Failed to remove temp directory: ${tempDir}`, error);
      // Non-critical error, continue
    }
    logger.debug('Failed to write buffer to temporary file', write_r.error);
    return err({
      code: 'EXIF_TEMP_FILE_WRITE_FAILED',
      message: 'Failed to write buffer to temporary file',
      cause: write_r.error,
      filePath: tempFilePath,
    });
  }

  try {
    const exif = await readExif(tempFilePath);
    return ok(exif);
  } catch (error) {
    logger.debug('Failed to read EXIF data', error);
    return err({
      code: 'EXIF_READ_FAILED',
      message: 'Failed to read EXIF data',
      cause: error,
      filePath: tempFilePath,
    });
  } finally {
    // クリーンアップ処理を統合
    await cleanupTempFiles(tempFilePath, tempDir);
  }
};

// アプリケーション終了時にExiftoolのインスタンスを終了
export const closeExiftoolInstance = async () => {
  if (exiftoolInstance) {
    await exiftoolInstance.end();
    exiftoolInstance = null;
  }
};

// 終了時のクリーンアップ処理
process.on('exit', () => closeExiftoolInstance());
process.on('SIGINT', () => process.exit());
process.on('SIGTERM', () => process.exit());
