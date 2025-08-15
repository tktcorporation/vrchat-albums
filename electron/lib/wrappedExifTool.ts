import * as exiftool from 'exiftool-vendored';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';
import * as tmp from 'tmp-promise';
import * as fs from './wrappedFs';

let exiftoolInstance: exiftool.ExifTool | null = null;
let exiftoolInitError: Error | null = null;

const getExiftoolInstance = async () => {
  if (exiftoolInitError) {
    throw exiftoolInitError;
  }

  if (!exiftoolInstance) {
    try {
      exiftoolInstance = new exiftool.ExifTool();
    } catch (error) {
      exiftoolInitError = new Error(
        'Failed to initialize ExifTool. This may be due to missing dependencies or platform incompatibility.',
        { cause: error },
      );
      throw exiftoolInitError;
    }
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
}): Promise<Result<void, Error>> => {
  try {
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

    return ok(undefined);
  } catch (error) {
    return err(new Error('Failed to write EXIF data', { cause: error }));
  }
};

export const setExifToBuffer = async (
  buffer: Buffer,
  exif: {
    description: string;
    dateTimeOriginal: string;
    timezoneOffset: string;
  },
): Promise<Result<Buffer, Error>> => {
  // 一時ファイルに書き込み
  const tmpFile = await tmp.file();
  const write_r = fs.writeFileSyncSafe(tmpFile.path, new Uint8Array(buffer));
  if (write_r.isErr()) {
    return err(
      new Error('Failed to write buffer to temporary file', {
        cause: write_r.error,
      }),
    );
  }

  const writeExifResult = await writeDateTimeWithTimezone({
    filePath: tmpFile.path,
    description: exif.description,
    dateTimeOriginal: exif.dateTimeOriginal,
    timezoneOffset: exif.timezoneOffset,
  });

  if (writeExifResult.isErr()) {
    // Try to clean up the temp file before returning
    await fs.unlinkAsync(tmpFile.path);
    return err(writeExifResult.error);
  }

  // 一時ファイルを読み込み
  const read_r = fs.readFileSyncSafe(tmpFile.path);
  if (read_r.isErr()) {
    return err(
      new Error('Failed to read temporary file', { cause: read_r.error }),
    );
  }

  // 一時ファイルを削除
  const delete_r = await fs.unlinkAsync(tmpFile.path);
  if (delete_r.isErr()) {
    return err(
      new Error('Failed to delete temporary file', { cause: delete_r.error }),
    );
  }

  return ok(read_r.value);
};

const readExif = async (
  filePath: string,
): Promise<Result<exiftool.Tags, Error>> => {
  try {
    const exiftool = await getExiftoolInstance();
    const exif = await exiftool.read(filePath);
    return ok(exif);
  } catch (error) {
    return err(new Error('Failed to read EXIF data', { cause: error }));
  }
};

export const readExifByBuffer = async (
  buffer: Buffer,
): Promise<Result<exiftool.Tags, Error>> => {
  // 一時ファイルに書き込み
  const tmpFile = await tmp.file();
  const write_r = await fs.writeFileSyncSafe(
    tmpFile.path,
    new Uint8Array(buffer),
  );
  if (write_r.isErr()) {
    return err(
      new Error('Failed to write buffer to temporary file', {
        cause: write_r.error,
      }),
    );
  }

  const exifResult = await readExif(tmpFile.path);

  // 一時ファイルを削除
  const unlink_r = await fs.unlinkAsync(tmpFile.path);
  if (unlink_r.isErr()) {
    return err(
      new Error('Failed to delete temporary file', { cause: unlink_r.error }),
    );
  }

  if (exifResult.isErr()) {
    return err(exifResult.error);
  }

  return ok(exifResult.value);
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
