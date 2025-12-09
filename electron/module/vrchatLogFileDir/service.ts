import path from 'node:path';
import * as neverthrow from 'neverthrow';
import { ResultAsync } from 'neverthrow';
import { P, match } from 'ts-pattern';
// import type * as vrchatLogService from '../service/vrchatLog/vrchatLog';
import * as fs from '../../lib/wrappedFs';
import { getSettingStore } from '../settingStore';
import { logger } from './../../lib/logger';
import {
  type NotValidatedVRChatLogFilesDirPath,
  NotValidatedVRChatLogFilesDirPathSchema,
  type VRChatLogFilePath,
  VRChatLogFilePathSchema,
  type VRChatLogFilesDirPath,
  VRChatLogFilesDirPathSchema,
} from './model';

type VRChatLogFileDirError = 'logFilesNotFound' | 'logFileDirNotFound';

/**
 * 設定ストアに保存されているログディレクトリパスを取得する
 * getValidVRChatLogFileDir から呼び出される内部処理
 */
const getStoredVRChatLogFilesDirPath = (): ResultAsync<
  NotValidatedVRChatLogFilesDirPath | null,
  never
> => {
  return ResultAsync.fromSafePromise(
    Promise.resolve(
      match(getSettingStore().getLogFilesDir())
        .with(null, () => null)
        .with(P.string, (path) =>
          NotValidatedVRChatLogFilesDirPathSchema.parse(path),
        )
        .exhaustive(),
    ),
  );
};

/**
 * 実際に存在するVRChatログディレクトリを検証して返す
 * getVRChatLogFileDir でエラーハンドリング付きの結果を生成するために使用
 */
export const getValidVRChatLogFileDir = async (): Promise<
  neverthrow.Result<
    {
      path: VRChatLogFilesDirPath;
      storedPath: NotValidatedVRChatLogFilesDirPath | null;
    },
    {
      error: 'logFilesNotFound' | 'logFileDirNotFound';
      storedPath: NotValidatedVRChatLogFilesDirPath | null;
      path: NotValidatedVRChatLogFilesDirPath;
    }
  >
> => {
  const storedVRChatLogFilesDirPathResult =
    await getStoredVRChatLogFilesDirPath();
  // getStoredVRChatLogFilesDirPath は never エラーなので常に成功
  const storedVRChatLogFilesDirPath =
    storedVRChatLogFilesDirPathResult._unsafeUnwrap();
  const vrChatlogFilesDir = match(storedVRChatLogFilesDirPath)
    .with(null, () => getDefaultVRChatVRChatLogFilesDir())
    .with(P.not(null), (path) => path)
    .exhaustive();
  const logFileNamesResult = await getVRChatLogFilePathList(vrChatlogFilesDir);
  if (logFileNamesResult.isErr()) {
    return neverthrow.err({
      error: match(logFileNamesResult.error)
        .with('ENOENT', () => 'logFileDirNotFound' as const)
        .exhaustive(),
      storedPath: storedVRChatLogFilesDirPath,
      path: vrChatlogFilesDir,
    });
  }
  if (logFileNamesResult.value.length === 0) {
    return neverthrow.err({
      error: 'logFilesNotFound',
      path: vrChatlogFilesDir,
      storedPath: storedVRChatLogFilesDirPath,
    });
  }
  const validatedVRChatLogFilesDirPath = VRChatLogFilesDirPathSchema.parse(
    vrChatlogFilesDir.value,
  );
  return neverthrow.ok({
    path: validatedVRChatLogFilesDirPath,
    storedPath: storedVRChatLogFilesDirPath,
  });
};

export type VRChatLogFileDirResult = {
  storedPath: NotValidatedVRChatLogFilesDirPath | null;
  path: NotValidatedVRChatLogFilesDirPath | VRChatLogFilesDirPath;
};

/**
 * ログディレクトリ検証結果を返す（Result型）
 * 設定画面や初期化処理から直接呼び出される
 */
export const getVRChatLogFileDir = (): ResultAsync<
  VRChatLogFileDirResult,
  VRChatLogFileDirError
> => {
  return ResultAsync.fromSafePromise(getValidVRChatLogFileDir()).andThen(
    (validatedResult) => {
      if (validatedResult.isErr()) {
        return neverthrow.err(validatedResult.error.error);
      }
      return neverthrow.ok({
        storedPath: validatedResult.value.storedPath,
        path: validatedResult.value.path,
      });
    },
  );
};

/**
 * OSごとのデフォルトVRChatログフォルダを返す
 * getValidVRChatLogFileDir のフォールバックとして利用
 */
const getDefaultVRChatVRChatLogFilesDir =
  (): NotValidatedVRChatLogFilesDirPath => {
    let VRChatlogFilesDir = '';
    if (process.platform === 'win32' && process.env.APPDATA) {
      const DEFAULT_VRCHAT_LOG_FILES_DIR = path.join(
        process.env.APPDATA || '',
        '..',
        'LocalLow',
        'VRChat',
        'VRChat',
      );
      VRChatlogFilesDir = DEFAULT_VRCHAT_LOG_FILES_DIR;
    } else {
      // 仮置き
      VRChatlogFilesDir = path.join(
        process.env.HOME || '',
        'Library',
        'Application Support',
        'com.vrchat.VRChat',
        'VRChat',
      );
    }
    return NotValidatedVRChatLogFilesDirPathSchema.parse(VRChatlogFilesDir);
  };

/**
 * VRChatのログファイルのパス一覧を取得する
 */
export const getVRChatLogFilePathList = async (
  vrChatlogFilesDir: VRChatLogFilesDirPath | NotValidatedVRChatLogFilesDirPath,
): Promise<neverthrow.Result<VRChatLogFilePath[], fs.FSError>> => {
  const logFileNamesResult = await fs.readdirAsync(vrChatlogFilesDir.value, {
    withFileTypes: true,
    encoding: 'buffer',
  });
  if (logFileNamesResult.isErr()) {
    return neverthrow.err(
      match(logFileNamesResult.error)
        .with({ code: 'ENOENT' }, () => 'ENOENT' as const)
        .exhaustive(),
    );
  }

  // output_log から始まるファイル名のみを取得
  const logFilePathList = logFileNamesResult.value
    .map((fileName) => {
      try {
        return VRChatLogFilePathSchema.parse(
          `${path.join(vrChatlogFilesDir.value, fileName.name.toString())}`,
        );
      } catch (e) {
        logger.debug('generally ignore this log', e);
        return null;
      }
    })
    .filter((fileName): fileName is VRChatLogFilePath => fileName !== null);
  return neverthrow.ok(logFilePathList);
};
