import * as nodeFs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as exiftool from 'exiftool-vendored';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';
import { v4 as uuidv4 } from 'uuid';
import { logger } from './logger';
import * as fs from './wrappedFs';

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

export const setExifToBuffer = async (
  buffer: Buffer,
  exif: {
    description: string;
    dateTimeOriginal: string;
    timezoneOffset: string;
  },
): Promise<Result<Buffer, Error>> => {
  // Windows短縮パス問題を回避するため、一時ディレクトリを作成
  let tempDir: string;
  let tempFilePath: string;

  try {
    tempDir = await nodeFs.promises.mkdtemp(path.join(os.tmpdir(), 'exif-'));
    tempFilePath = path.join(tempDir, `${uuidv4()}.png`);
  } catch (error) {
    return err(
      new Error('Failed to create temporary directory', { cause: error }),
    );
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
    return err(
      new Error('Failed to write buffer to temporary file', {
        cause: write_r.error,
      }),
    );
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
      return err(
        new Error('Failed to read temporary file', { cause: read_r.error }),
      );
    }

    return ok(read_r.value);
  } finally {
    // クリーンアップ
    try {
      await nodeFs.promises.unlink(tempFilePath);
    } catch (error) {
      logger.debug(`Failed to remove temp file: ${tempFilePath}`, error);
      // Non-critical error, continue
    }
    try {
      await nodeFs.promises.rmdir(tempDir);
    } catch (error) {
      logger.debug(`Failed to remove temp directory: ${tempDir}`, error);
      // Non-critical error, continue
    }
  }
};

const readExif = async (filePath: string) => {
  const exiftool = await getExiftoolInstance();
  const exif = await exiftool.read(filePath);
  return exif;
};

export const readExifByBuffer = async (
  buffer: Buffer,
): Promise<Result<exiftool.Tags, Error>> => {
  // Windows短縮パス問題を回避するため、一時ディレクトリを作成
  let tempDir: string;
  let tempFilePath: string;

  try {
    tempDir = await nodeFs.promises.mkdtemp(path.join(os.tmpdir(), 'exif-'));
    tempFilePath = path.join(tempDir, `${uuidv4()}.png`);
  } catch (error) {
    return err(
      new Error('Failed to create temporary directory', { cause: error }),
    );
  }

  // 一時ファイルに書き込み
  const write_r = await fs.writeFileSyncSafe(
    tempFilePath,
    new Uint8Array(buffer),
  );
  if (write_r.isErr()) {
    // クリーンアップ
    try {
      await nodeFs.promises.rmdir(tempDir);
    } catch (error) {
      logger.debug(`Failed to remove temp directory: ${tempDir}`, error);
      // Non-critical error, continue
    }
    return err(
      new Error('Failed to write buffer to temporary file', {
        cause: write_r.error,
      }),
    );
  }

  try {
    const exif = await readExif(tempFilePath);
    return ok(exif);
  } catch (error) {
    return err(new Error('Failed to read EXIF data', { cause: error }));
  } finally {
    // クリーンアップ
    try {
      await nodeFs.promises.unlink(tempFilePath);
    } catch (error) {
      logger.debug(`Failed to remove temp file: ${tempFilePath}`, error);
      // Non-critical error, continue
    }
    try {
      await nodeFs.promises.rmdir(tempDir);
    } catch (error) {
      logger.debug(`Failed to remove temp directory: ${tempDir}`, error);
      // Non-critical error, continue
    }
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
