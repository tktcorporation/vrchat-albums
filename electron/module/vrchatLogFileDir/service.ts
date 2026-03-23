import path from 'node:path';

import { Effect } from 'effect';
import { match, P } from 'ts-pattern';

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
const getStoredVRChatLogFilesDirPath =
  (): Effect.Effect<NotValidatedVRChatLogFilesDirPath | null> => {
    return Effect.succeed(
      match(getSettingStore().getLogFilesDir())
        .with(null, () => null)
        .with(P.string, (dirPath) =>
          NotValidatedVRChatLogFilesDirPathSchema.parse(dirPath),
        )
        .exhaustive(),
    );
  };

/**
 * 実際に存在するVRChatログディレクトリを検証して返す
 * getVRChatLogFileDir でエラーハンドリング付きの結果を生成するために使用
 */
export const getValidVRChatLogFileDir = (): Effect.Effect<
  {
    path: VRChatLogFilesDirPath;
    storedPath: NotValidatedVRChatLogFilesDirPath | null;
  },
  {
    error: 'logFilesNotFound' | 'logFileDirNotFound';
    storedPath: NotValidatedVRChatLogFilesDirPath | null;
    path: NotValidatedVRChatLogFilesDirPath;
  }
> => {
  return Effect.gen(function* () {
    const storedVRChatLogFilesDirPath = yield* getStoredVRChatLogFilesDirPath();
    const vrChatlogFilesDir = match(storedVRChatLogFilesDirPath)
      .with(null, () => getDefaultVRChatVRChatLogFilesDir())
      .with(P.not(null), (storedPath) => storedPath)
      .exhaustive();
    const logFileNamesResult = yield* Effect.either(
      getVRChatLogFilePathList(vrChatlogFilesDir),
    );
    if (logFileNamesResult._tag === 'Left') {
      return yield* Effect.fail({
        error: match(logFileNamesResult.left)
          .with('ENOENT', () => 'logFileDirNotFound' as const)
          .exhaustive(),
        storedPath: storedVRChatLogFilesDirPath,
        path: vrChatlogFilesDir,
      });
    }
    if (logFileNamesResult.right.length === 0) {
      return yield* Effect.fail({
        error: 'logFilesNotFound' as const,
        path: vrChatlogFilesDir,
        storedPath: storedVRChatLogFilesDirPath,
      });
    }
    const validatedVRChatLogFilesDirPath = VRChatLogFilesDirPathSchema.parse(
      vrChatlogFilesDir.value,
    );
    return {
      path: validatedVRChatLogFilesDirPath,
      storedPath: storedVRChatLogFilesDirPath,
    };
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
export const getVRChatLogFileDir = (): Effect.Effect<
  VRChatLogFileDirResult,
  VRChatLogFileDirError
> => {
  return getValidVRChatLogFileDir().pipe(
    Effect.map((result) => ({
      storedPath: result.storedPath,
      path: result.path,
    })),
    Effect.mapError((e) => e.error),
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
export const getVRChatLogFilePathList = (
  vrChatlogFilesDir: VRChatLogFilesDirPath | NotValidatedVRChatLogFilesDirPath,
): Effect.Effect<VRChatLogFilePath[], fs.FSError> => {
  return Effect.gen(function* () {
    const logFileNames = yield* fs
      .readdirAsync(vrChatlogFilesDir.value, {
        withFileTypes: true,
        encoding: 'buffer',
      })
      .pipe(Effect.mapError(() => 'ENOENT' as const));

    // output_log から始まるファイル名のみを取得
    const logFilePathList = logFileNames
      .map((fileName) => {
        const result = VRChatLogFilePathSchema.safeParse(
          path.join(vrChatlogFilesDir.value, fileName.name.toString()),
        );
        if (!result.success) {
          logger.debug('generally ignore this log', result.error);
          return null;
        }
        return result.data;
      })
      .filter((fileName): fileName is VRChatLogFilePath => fileName !== null);
    return logFilePathList;
  });
};
