import * as crypto from 'node:crypto';
import * as fsPromises from 'node:fs/promises';
import * as os from 'node:os';
import { performance } from 'node:perf_hooks';
import * as dateFns from 'date-fns';
import { glob } from 'glob';
import * as neverthrow from 'neverthrow';
import { ResultAsync } from 'neverthrow';
import * as path from 'pathe';
import sharp from 'sharp';
import { match, P } from 'ts-pattern';
import { logger } from './../../lib/logger';
import * as fs from './../../lib/wrappedFs';
import { getSettingStore } from '../settingStore';
import * as model from './model/vrchatPhotoPath.model';
import {
  type VRChatPhotoDirPath,
  VRChatPhotoDirPathSchema,
} from './valueObjects';

// サムネイルキャッシュの設定
const THUMBNAIL_CACHE_DIR_NAME = 'vrchat-albums-thumbnails';
const MAX_CACHE_SIZE_MB = 500; // キャッシュの最大サイズ
const CACHE_CLEANUP_THRESHOLD = 0.9; // キャッシュサイズがこの割合を超えたらクリーンアップ
const CACHE_EXPIRY_DAYS = 7; // キャッシュの有効期限（日数）

// 書き込み中のキャッシュキーを追跡（競合防止）
const pendingCacheWrites = new Set<string>();

// キャッシュ書き込み失敗のトラッキング（サイレントエラー防止）
const CACHE_FAILURE_THRESHOLD = 10;
let consecutiveCacheFailures = 0;

/**
 * テスト環境かどうかを判定する
 * Playwright、Vitest等のテスト環境ではElectronモジュールが利用不可
 */
const isTestEnvironment = (): boolean => {
  return (
    process.env.PLAYWRIGHT_TEST === 'true' ||
    process.env.VITEST === 'true' ||
    process.env.NODE_ENV === 'test'
  );
};

/**
 * Electronのappモジュールを遅延取得する
 * Playwrightテスト時のクラッシュを防ぐため、トップレベルインポートを避ける
 *
 * ## 環境による動作の違い
 * - テスト環境: Electronを試行せずnullを返す（想定された動作）
 * - 開発/プロダクション環境: Electronのロードを試行し、失敗時はエラーログ出力
 *
 * @returns Electron appモジュール、または利用不可時はnull
 */
const getElectronApp = (): typeof import('electron').app | null => {
  // テスト環境ではElectronを試行しない（想定された動作）
  if (isTestEnvironment()) {
    logger.debug('Test environment detected, skipping Electron module');
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron') as typeof import('electron');
    return app;
  } catch (error) {
    // 開発/プロダクション環境でのElectronロード失敗は予期しない
    // Sentryに送信して問題を検知できるようにする
    if (process.env.NODE_ENV === 'production') {
      logger.error({
        message: 'Failed to load Electron app module in production environment',
        stack: error instanceof Error ? error : new Error(String(error)),
      });
    } else {
      // 開発環境では警告レベル（Electronなしでの動作確認時など）
      logger.warn({
        message: 'Electron app module not available, using fallback paths',
        stack: error instanceof Error ? error : new Error(String(error)),
      });
    }
    return null;
  }
};

/**
 * サムネイルキャッシュディレクトリのパスを取得
 */
const getThumbnailCacheDir = (): string => {
  const app = getElectronApp();
  if (app) {
    try {
      return path.join(app.getPath('temp'), THUMBNAIL_CACHE_DIR_NAME);
    } catch {
      // アプリ未初期化時はフォールバック
      logger.debug('app.getPath("temp") failed, using os.tmpdir() fallback');
    }
  }
  // テスト環境などでappが使えない場合
  return path.join(os.tmpdir(), THUMBNAIL_CACHE_DIR_NAME);
};

/**
 * キャッシュキーを生成（ファイルパスとサイズからハッシュを生成）
 */
const generateCacheKey = (photoPath: string, width?: number): string => {
  const normalizedPath = path.normalize(photoPath);
  const key = `${normalizedPath}:${width ?? 'original'}`;
  return crypto.createHash('md5').update(key).digest('hex');
};

/**
 * キャッシュディレクトリ初期化エラー
 */
interface CacheDirError {
  type: 'CACHE_DIR_CREATION_FAILED';
  message: string;
  code?: string;
}

/**
 * キャッシュディレクトリを初期化
 *
 * @returns ResultAsync<cacheDir, CacheDirError> - 成功時はディレクトリパス、失敗時はエラー
 */
const ensureCacheDir = (): neverthrow.ResultAsync<string, CacheDirError> => {
  const cacheDir = getThumbnailCacheDir();
  return neverthrow.ResultAsync.fromPromise(
    fsPromises.mkdir(cacheDir, { recursive: true }),
    (error) => {
      // ディレクトリが既に存在する場合は成功扱い（後でmapで処理）
      // それ以外はエラー
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'EEXIST') {
        // この分岐はResultAsync.fromPromiseでは直接okを返せないので、
        // エラーとして返し後でフィルタリング
        return {
          type: 'CACHE_DIR_CREATION_FAILED' as const,
          message: 'EEXIST',
          code: 'EEXIST',
        };
      }
      logger.error({
        message: `Failed to create cache directory: ${cacheDir}`,
        stack: error instanceof Error ? error : new Error(String(error)),
      });
      return {
        type: 'CACHE_DIR_CREATION_FAILED' as const,
        message: `Cannot create cache directory: ${cacheDir}`,
        code: nodeError.code,
      };
    },
  )
    .map(() => cacheDir)
    .orElse((error) => {
      // EEXIST の場合は成功として扱う
      if (error.code === 'EEXIST') {
        return neverthrow.ok(cacheDir);
      }
      return neverthrow.err(error);
    });
};

/**
 * キャッシュ読み取り結果の型
 *
 * キャッシュミスと予期しないエラーを区別するための discriminated union
 */
type CacheReadResult =
  | { status: 'hit'; data: Buffer }
  | {
      status: 'miss';
      reason: 'not_found' | 'expired' | 'cache_dir_unavailable';
    }
  | { status: 'error'; error: Error };

/**
 * キャッシュファイルのstat結果
 */
type CacheStatError =
  | { type: 'NOT_FOUND' }
  | { type: 'IO_ERROR'; error: Error };

/**
 * キャッシュファイルのstatを取得（ResultAsync版）
 */
const statCacheFile = (
  cachePath: string,
): neverthrow.ResultAsync<
  { stats: Awaited<ReturnType<typeof fsPromises.stat>>; cachePath: string },
  CacheStatError
> =>
  neverthrow.ResultAsync.fromPromise(
    fsPromises.stat(cachePath).then((stats) => ({ stats, cachePath })),
    (error): CacheStatError => {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        return { type: 'NOT_FOUND' };
      }
      const err = error instanceof Error ? error : new Error(String(error));
      logger.warn({
        message: `Unexpected error reading cached thumbnail stat: ${cachePath}`,
        stack: err,
      });
      return { type: 'IO_ERROR', error: err };
    },
  );

/**
 * キャッシュファイルを読み込み（ResultAsync版）
 */
const readCacheFile = (
  cachePath: string,
): neverthrow.ResultAsync<Buffer, CacheStatError> =>
  neverthrow.ResultAsync.fromPromise(
    fsPromises.readFile(cachePath),
    (error): CacheStatError => {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        return { type: 'NOT_FOUND' };
      }
      const err = error instanceof Error ? error : new Error(String(error));
      logger.warn({
        message: `Unexpected error reading cached thumbnail: ${cachePath}`,
        stack: err,
      });
      return { type: 'IO_ERROR', error: err };
    },
  );

/**
 * キャッシュからサムネイルを取得
 *
 * @param cacheKey キャッシュキー（generateCacheKeyで生成）
 * @returns 構造化された結果（hit/miss/error を区別可能）
 *
 * ## 戻り値の例
 * - { status: 'hit', data: Buffer } - キャッシュヒット
 * - { status: 'miss', reason: 'not_found' } - キャッシュファイルなし
 * - { status: 'miss', reason: 'expired' } - キャッシュ有効期限切れ
 * - { status: 'error', error: Error } - 予期しないエラー（権限、I/O等）
 */
const getCachedThumbnail = async (
  cacheKey: string,
): Promise<CacheReadResult> => {
  const cacheDirResult = await ensureCacheDir();
  if (cacheDirResult.isErr()) {
    // キャッシュディレクトリが利用不可の場合
    logger.debug({
      message: 'Cache directory unavailable, skipping cache lookup',
      stack: new Error(cacheDirResult.error.message),
    });
    return { status: 'miss', reason: 'cache_dir_unavailable' };
  }

  const cachePath = path.join(cacheDirResult.value, `${cacheKey}.webp`);

  // キャッシュファイルのstatを取得
  const statResult = await statCacheFile(cachePath);
  if (statResult.isErr()) {
    return match(statResult.error)
      .with({ type: 'NOT_FOUND' }, () => ({
        status: 'miss' as const,
        reason: 'not_found' as const,
      }))
      .with({ type: 'IO_ERROR' }, ({ error }) => ({
        status: 'error' as const,
        error,
      }))
      .exhaustive();
  }

  // キャッシュが有効期限を超えている場合は無効
  const { stats } = statResult.value;
  const cacheDate = new Date(Number(stats.mtimeMs));
  const expiryDate = dateFns.subDays(new Date(), CACHE_EXPIRY_DAYS);
  if (cacheDate < expiryDate) {
    return { status: 'miss', reason: 'expired' };
  }

  // キャッシュファイルを読み込み
  const readResult = await readCacheFile(cachePath);
  return readResult.match(
    (data) => ({ status: 'hit' as const, data }),
    (error) =>
      match(error)
        .with({ type: 'NOT_FOUND' }, () => ({
          status: 'miss' as const,
          reason: 'not_found' as const,
        }))
        .with({ type: 'IO_ERROR' }, ({ error: err }) => ({
          status: 'error' as const,
          error: err,
        }))
        .exhaustive(),
  );
};

/**
 * サムネイルをキャッシュに保存（アトミック書き込み + 競合防止）
 *
 * 複数の同時リクエストが同一キーに書き込もうとした場合:
 * - 最初のリクエストのみが書き込みを実行
 * - 後続のリクエストは早期リターン（既に書き込み中のため）
 *
 * アトミック書き込み:
 * - 一時ファイル (.tmp) に書き込み
 * - rename で本来のパスに移動
 * - これにより書き込み途中のファイルが読まれることを防止
 */
const saveThumbnailToCache = async (
  cacheKey: string,
  buffer: Buffer,
): Promise<void> => {
  // 既に書き込み中の場合はスキップ
  if (pendingCacheWrites.has(cacheKey)) {
    return;
  }
  pendingCacheWrites.add(cacheKey);

  try {
    const cacheDirResult = await ensureCacheDir();
    if (cacheDirResult.isErr()) {
      // キャッシュディレクトリが利用不可の場合は書き込みをスキップ
      logger.debug({
        message: 'Cache directory unavailable, skipping cache write',
        stack: new Error(cacheDirResult.error.message),
      });
      return;
    }

    const cachePath = path.join(cacheDirResult.value, `${cacheKey}.webp`);
    const tempPath = `${cachePath}.tmp`;

    // アトミック書き込み: tmp -> rename
    await fsPromises.writeFile(tempPath, buffer);
    await fsPromises.rename(tempPath, cachePath);

    // 書き込み成功: 連続失敗カウンターをリセット
    consecutiveCacheFailures = 0;
  } catch (error) {
    // 失敗カウントをインクリメント
    consecutiveCacheFailures++;

    logger.error({
      message: `Failed to save thumbnail to cache: ${cacheKey}`,
      stack: error instanceof Error ? error : new Error(String(error)),
    });

    // 連続失敗が閾値を超えた場合、ユーザーに通知できるレベルで警告
    if (consecutiveCacheFailures >= CACHE_FAILURE_THRESHOLD) {
      logger.warn({
        message: `Thumbnail cache has failed ${consecutiveCacheFailures} times consecutively. Cache may be unavailable (disk full, permission issues, etc.)`,
        details: {
          consecutiveFailures: consecutiveCacheFailures,
          lastError: error instanceof Error ? error.message : String(error),
        },
      });
      // リセットしてログスパムを防ぐ
      consecutiveCacheFailures = 0;
    }
  } finally {
    pendingCacheWrites.delete(cacheKey);
  }
};

/**
 * キャッシュファイルのstat取得（クリーンアップ用）
 * ENOENT はレースコンディションで予期されるため、null を返す
 */
type CacheFileStatResult = {
  filePath: string;
  stats: Awaited<ReturnType<typeof fsPromises.stat>>;
  size: number;
  mtime: number;
} | null;

const statCacheFileForCleanup = (
  filePath: string,
): neverthrow.ResultAsync<CacheFileStatResult, never> =>
  neverthrow.ResultAsync.fromSafePromise(
    fsPromises
      .stat(filePath)
      .then(
        (stats): CacheFileStatResult => ({
          filePath,
          stats,
          size: Number(stats.size),
          mtime: Number(stats.mtimeMs),
        }),
      )
      .catch((error): null => {
        const nodeError = error as NodeJS.ErrnoException;
        // ENOENT はレースコンディション（ファイル削除）で予期される → null
        if (nodeError.code === 'ENOENT') {
          return null;
        }
        // その他のエラー（権限、I/O）はログ出力して null を返す
        // キャッシュクリーンアップは失敗しても致命的ではない
        logger.debug({
          message: `Failed to stat cache file: ${filePath}`,
          stack: error instanceof Error ? error : new Error(String(error)),
        });
        return null;
      }),
  );

/**
 * キャッシュファイル削除（クリーンアップ用）
 * 削除失敗は警告ログを出力して継続（致命的ではない）
 */
const unlinkCacheFile = (
  filePath: string,
): neverthrow.ResultAsync<boolean, never> =>
  neverthrow.ResultAsync.fromSafePromise(
    fsPromises
      .unlink(filePath)
      .then(() => true)
      .catch((error): false => {
        // 削除失敗をログ出力（処理は継続）
        logger.warn({
          message: `Failed to delete cache file during cleanup: ${filePath}`,
          stack: error instanceof Error ? error : new Error(String(error)),
        });
        return false;
      }),
  );

/**
 * キャッシュディレクトリの読み取りエラー
 */
type CacheReaddirError =
  | { type: 'PERMISSION_DENIED'; message: string }
  | { type: 'IO_ERROR'; message: string };

/**
 * キャッシュディレクトリを読み取る
 */
const readCacheDir = (
  cacheDir: string,
): neverthrow.ResultAsync<string[], CacheReaddirError> =>
  neverthrow.ResultAsync.fromPromise(
    fsPromises.readdir(cacheDir),
    (error): CacheReaddirError => {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'EACCES' || nodeError.code === 'EPERM') {
        return {
          type: 'PERMISSION_DENIED',
          message: `Permission denied reading cache directory: ${cacheDir}`,
        };
      }
      return {
        type: 'IO_ERROR',
        message: `Failed to read cache directory: ${nodeError.message}`,
      };
    },
  );

/**
 * 古いキャッシュをクリーンアップ（必要に応じて呼び出される）
 */
export const cleanupThumbnailCache = async (): Promise<void> => {
  const cacheDirResult = await ensureCacheDir();
  if (cacheDirResult.isErr()) {
    // キャッシュディレクトリが利用不可の場合はクリーンアップをスキップ
    logger.debug({
      message: 'Cache directory unavailable, skipping cleanup',
      stack: new Error(cacheDirResult.error.message),
    });
    return;
  }
  const cacheDir = cacheDirResult.value;

  const filesResult = await readCacheDir(cacheDir);
  if (filesResult.isErr()) {
    logger.error({
      message: 'Failed to cleanup thumbnail cache',
      stack: new Error(filesResult.error.message),
    });
    return;
  }

  const files = filesResult.value;
  const fileStats = await Promise.all(
    files.map((file) => {
      const filePath = path.join(cacheDir, file);
      return statCacheFileForCleanup(filePath).then((r) => r._unsafeUnwrap());
    }),
  );

  const validFiles = fileStats.filter(
    (f): f is NonNullable<CacheFileStatResult> => f !== null,
  );
  const totalSizeMB =
    validFiles.reduce((sum, f) => sum + f.size, 0) / 1024 / 1024;

  // キャッシュサイズがしきい値を超えている場合のみクリーンアップ
  if (totalSizeMB < MAX_CACHE_SIZE_MB * CACHE_CLEANUP_THRESHOLD) {
    return;
  }

  logger.info(
    `Cleaning up thumbnail cache. Current size: ${totalSizeMB.toFixed(2)}MB`,
  );

  // 古いファイルから削除
  const sortedFiles = validFiles.sort((a, b) => a.mtime - b.mtime);
  let currentSize = totalSizeMB;
  const targetSize = MAX_CACHE_SIZE_MB * 0.5; // 50%まで削減

  for (const file of sortedFiles) {
    if (currentSize <= targetSize) {
      break;
    }
    const deleted = await unlinkCacheFile(file.filePath).then((r) =>
      r._unsafeUnwrap(),
    );
    if (deleted) {
      currentSize -= file.size / 1024 / 1024;
    }
  }

  logger.info(
    `Thumbnail cache cleanup completed. New size: ${currentSize.toFixed(2)}MB`,
  );
};

/**
 * VRChat の写真が保存されている場所のデフォルト値を取得する
 */
const getDefaultVRChatPhotoDir = (): VRChatPhotoDirPath => {
  let logFilesDir: string;

  if (process.platform === 'win32' && process.env.USERPROFILE) {
    const app = getElectronApp();
    const picturesPath = app?.getPath('pictures');
    // app.getPath('pictures') はフルパスを返す (例: C:\Users\xxx\Pictures)
    // フォールバック時は USERPROFILE/Pictures を使用
    logFilesDir = picturesPath
      ? path.join(picturesPath, 'VRChat')
      : path.join(process.env.USERPROFILE, 'Pictures', 'VRChat');
  } else {
    logFilesDir = path.join(process.env.HOME || '', 'Pictures', 'VRChat');
  }

  return VRChatPhotoDirPathSchema.parse(logFilesDir);
};

/**
 * VRChat の写真が保存されている場所を指定、保存する
 */
export const setVRChatPhotoDirPathToSettingStore = (
  photoDir: VRChatPhotoDirPath,
) => {
  const settingStore = getSettingStore();
  settingStore.setVRChatPhotoDir(photoDir.value);
};

/**
 * VRChat の写真が保存されている場所をクリアする
 */
export const clearVRChatPhotoDirPathInSettingStore = () => {
  const settingStore = getSettingStore();
  const result = settingStore.clearStoredSetting('vrchatPhotoDir');
  if (result.isErr()) {
    throw result.error;
  }
};

/**
 * VRChat の写真の保存場所を取得する
 * 指定された場所が保存されていない場合は、デフォルトの場所を返す
 */
export const getVRChatPhotoDirPath = (): VRChatPhotoDirPath => {
  // 写真の保存箇所を取得
  const photoDir = getDefaultVRChatPhotoDir();

  // 保存箇所が設定されている場合はそれを返す
  const settingStore = getSettingStore();
  const storedPhotoDir = settingStore.getVRChatPhotoDir();
  if (storedPhotoDir) {
    return VRChatPhotoDirPathSchema.parse(storedPhotoDir);
  }

  return photoDir;
};

// バッチサイズ定数
const PHOTO_METADATA_BATCH_SIZE = 100; // メタデータ取得用（sharp処理は重いため小さく）
const MAX_MEMORY_USAGE_MB = 500; // メモリ使用量の上限

/**
 * メモリ使用量をチェックする
 */
const checkMemoryUsage = (): { heapUsedMB: number; isHighUsage: boolean } => {
  const memUsage = process.memoryUsage();
  const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
  return {
    heapUsedMB,
    isHighUsage: heapUsedMB > MAX_MEMORY_USAGE_MB,
  };
};

/**
 * 写真パスをバッチごとに取得するジェネレータ関数
 * glob.stream() を使用してメモリ効率を改善
 */
async function* getPhotoPathBatches(
  dirPath: VRChatPhotoDirPath,
  lastProcessedDate?: Date | null,
): AsyncGenerator<string[], void, unknown> {
  const targetDir = dirPath.value;
  if (!targetDir) {
    return;
  }

  // Convert to POSIX format for glob pattern matching
  const normalizedTargetDir = path.normalize(targetDir).replace(/\\/g, '/');

  // glob.stream() を使用してストリーミング処理（メモリ効率向上）
  const globStream = glob.stream(`${normalizedTargetDir}/**/VRChat_*.png`);

  let batch: string[] = [];
  let processedCount = 0;

  for await (const photoPath of globStream) {
    const photoPathStr =
      typeof photoPath === 'string' ? photoPath : String(photoPath);

    // 日付フィルタリングが必要な場合
    if (lastProcessedDate) {
      const statsResult = await neverthrow.ResultAsync.fromPromise(
        fsPromises.stat(photoPathStr),
        (error): { type: 'STAT_ERROR'; message: string } => {
          const nodeError = error as NodeJS.ErrnoException;
          // ENOENT はファイル削除のレースコンディションで予期される
          if (nodeError.code === 'ENOENT') {
            return { type: 'STAT_ERROR', message: 'File not found' };
          }
          // その他のエラーはログ出力
          logger.error({
            message: `Failed to get stats for ${photoPathStr}`,
            stack: error instanceof Error ? error : new Error(String(error)),
          });
          return { type: 'STAT_ERROR', message: nodeError.message };
        },
      );

      if (statsResult.isErr()) {
        continue; // エラー時はスキップ
      }

      if (statsResult.value.mtime <= lastProcessedDate) {
        continue; // 古いファイルはスキップ
      }
    }

    batch.push(photoPathStr);
    processedCount++;

    // バッチサイズに達したらyield
    if (batch.length >= PHOTO_METADATA_BATCH_SIZE) {
      yield batch;
      batch = [];

      // メモリ使用量をチェック
      if (processedCount % 1000 === 0) {
        const { heapUsedMB, isHighUsage } = checkMemoryUsage();
        if (isHighUsage) {
          logger.warn(
            `High memory usage detected: ${heapUsedMB.toFixed(2)}MB. Consider processing in smaller batches.`,
          );
          // GCを促すためのヒント
          if (global.gc) {
            global.gc();
          }
        }
      }
    }
  }

  // 残りのバッチをyield
  if (batch.length > 0) {
    yield batch;
  }
}

/**
 * 写真情報のバッチを処理する
 * メモリ効率を考慮し、並列処理数を制限
 */
async function processPhotoBatch(
  photoPaths: string[],
): Promise<
  Array<{ photoPath: string; takenAt: Date; width: number; height: number }>
> {
  const results: Array<{
    photoPath: string;
    takenAt: Date;
    width: number;
    height: number;
  }> = [];
  const PARALLEL_LIMIT = 10; // sharp処理の並列数を制限

  // 並列処理数を制限しながらバッチ処理
  for (let i = 0; i < photoPaths.length; i += PARALLEL_LIMIT) {
    const subBatch = photoPaths.slice(i, i + PARALLEL_LIMIT);

    const photoInfoPromises = subBatch.map(async (photoPath) => {
      const matchResult = photoPath.match(
        /VRChat_(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.\d{3})/,
      );
      if (!matchResult) {
        return null;
      }

      const takenAt = dateFns.parse(
        matchResult[1],
        'yyyy-MM-dd_HH-mm-ss.SSS',
        new Date(),
      );

      // sharpインスタンスを使い捨てにしてメモリリークを防ぐ
      const metadataResult = await neverthrow.ResultAsync.fromPromise(
        sharp(photoPath).metadata(),
        (error): { type: 'SHARP_ERROR'; message: string } => {
          logger.error({
            message: `Failed to process photo metadata for ${photoPath}`,
            stack: error instanceof Error ? error : new Error(String(error)),
          });
          return {
            type: 'SHARP_ERROR',
            message: error instanceof Error ? error.message : String(error),
          };
        },
      );

      if (metadataResult.isErr()) {
        return null;
      }

      const metadata = metadataResult.value;
      const height = metadata.height ?? 720;
      const width = metadata.width ?? 1280;

      return {
        photoPath,
        takenAt,
        width,
        height,
      };
    });

    const subResults = (await Promise.all(photoInfoPromises)).filter(
      (
        info,
      ): info is {
        photoPath: string;
        takenAt: Date;
        width: number;
        height: number;
      } => info !== null,
    );

    results.push(...subResults);
  }

  return results;
}

/**
 * 写真ディレクトリを走査してインデックスを更新する
 * logSync などから呼び出される
 */
export const createVRChatPhotoPathIndex = async (
  lastProcessedDate?: Date | null,
) => {
  const startTime = performance.now();
  const targetDir = getVRChatPhotoDirPath();
  const settingStore = getSettingStore();
  const extraDirs = settingStore.getVRChatPhotoExtraDirList();

  const allDirs = [targetDir, ...extraDirs];
  let totalProcessed = 0;
  let batchNumber = 0;
  const allCreatedModels: model.VRChatPhotoPathModel[] = [];

  logger.info(
    `Starting photo index creation with ${allDirs.length} directories`,
  );

  // 各ディレクトリを順番に処理
  for (const dir of allDirs) {
    logger.debug(`Processing photos from directory: ${dir.value}`);

    // バッチごとに処理
    for await (const photoBatch of getPhotoPathBatches(
      dir,
      lastProcessedDate,
    )) {
      if (photoBatch.length === 0) continue;

      batchNumber++;
      const batchStartTime = performance.now();

      // バッチ内の写真情報を処理
      const processedBatch = await processPhotoBatch(photoBatch);

      if (processedBatch.length > 0) {
        // DBに保存
        const dbStartTime = performance.now();
        const createdModels = await model.createOrUpdateListVRChatPhotoPath(
          processedBatch.map((photo) => ({
            photoPath: photo.photoPath,
            photoTakenAt: photo.takenAt,
            width: photo.width,
            height: photo.height,
          })),
        );
        const dbEndTime = performance.now();

        allCreatedModels.push(...createdModels);
        totalProcessed += processedBatch.length;

        const batchEndTime = performance.now();
        logger.debug(
          `Batch ${batchNumber}: Processed ${
            processedBatch.length
          } photos in ${(batchEndTime - batchStartTime).toFixed(
            2,
          )} ms (metadata: ${(dbStartTime - batchStartTime).toFixed(
            2,
          )} ms, DB: ${(dbEndTime - dbStartTime).toFixed(2)} ms)`,
        );

        // メモリ使用量のログ（デバッグ用）
        if (batchNumber % 10 === 0) {
          const memUsage = process.memoryUsage();
          logger.debug(
            `Memory usage after batch ${batchNumber}: RSS=${(
              memUsage.rss / 1024 / 1024
            ).toFixed(2)}MB, Heap=${(memUsage.heapUsed / 1024 / 1024).toFixed(
              2,
            )}MB`,
          );
        }
      }
    }
  }

  const totalEndTime = performance.now();

  if (totalProcessed === 0) {
    logger.debug('No new photos found to index.');
    return [];
  }

  logger.info(
    `Photo index creation completed: ${totalProcessed} photos processed in ${
      totalEndTime - startTime
    } ms (${batchNumber} batches)`,
  );

  return allCreatedModels;
};

/**
 * 写真パスモデルを条件付きで取得する
 * コントローラー経由で一覧表示に利用される
 * ページネーション対応でメモリ使用量を抑える
 */
export const getVRChatPhotoPathList = async (query?: {
  gtPhotoTakenAt?: Date;
  ltPhotoTakenAt?: Date;
  orderByPhotoTakenAt: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}) => {
  return model.getVRChatPhotoPathList(query);
};

/**
 * 写真の総件数を取得する（ページネーション用）
 */
export const getVRChatPhotoPathCount = async (query?: {
  gtPhotoTakenAt?: Date;
  ltPhotoTakenAt?: Date;
}) => {
  return model.getVRChatPhotoPathCount(query);
};

/**
 * 月別の写真枚数を取得する
 * 統計情報としてフロントエンドへ返す
 */
export const getCountByYearMonthList = async () => {
  return model.getCountByYearMonthList();
};

/**
 * VRChat の写真のパスが有効かどうかを検証する
 * 無効な場合は削除する
 */
export const validateVRChatPhotoPathModel = async ({
  fullpath,
}: {
  fullpath: string;
}): Promise<'MODEL_NOT_FOUND' | 'VALID' | 'FILE_NOT_FOUND_MODEL_DELETED'> => {
  const pathModel = await model.getVRChatPhotoPathByPhotoPath(fullpath);
  if (!pathModel) {
    return 'MODEL_NOT_FOUND';
  }
  if (!fs.existsSyncSafe(pathModel.photoPath)) {
    await model.deleteVRChatPhotoPathModel(pathModel);
    return 'FILE_NOT_FOUND_MODEL_DELETED';
  }
  return 'VALID';
};

/**
 * 画像ファイルを読み込み Base64 文字列で返す
 * テストやプレビュー生成で利用される
 *
 * メモリ効率のため、サムネイルはディスクキャッシュを使用:
 * - width指定時: WebP形式でキャッシュし、再利用
 * - 元サイズ時: キャッシュなし（大きすぎるため）
 */
export const getVRChatPhotoItemData = async ({
  photoPath,
  width,
}: {
  photoPath: string;
  // 指定しない場合は元画像のサイズをそのまま返す
  width?: number;
}): Promise<neverthrow.Result<string, 'InputFileIsMissing'>> => {
  // ResultAsync.fromPromise で予期されたエラー (InputFileIsMissing) を処理
  return ResultAsync.fromPromise(
    (async () => {
      // サムネイル（width指定あり）の場合はキャッシュを使用
      if (width !== undefined) {
        const cacheKey = generateCacheKey(photoPath, width);

        // キャッシュから取得を試みる（構造化された結果で判定）
        const cacheResult = await getCachedThumbnail(cacheKey);

        // ts-patternでキャッシュ結果を処理
        const cachedData = match(cacheResult)
          .with({ status: 'hit' }, ({ data }) => data)
          .with({ status: 'miss' }, () => null)
          .with({ status: 'error' }, ({ error }) => {
            // エラー時はログ出力済み、生成にフォールバック
            logger.debug({
              message: `Cache read error for ${cacheKey}, regenerating thumbnail`,
              stack: error,
            });
            return null;
          })
          .exhaustive();

        if (cachedData) {
          return `data:image/webp;base64,${cachedData.toString('base64')}`;
        }

        // キャッシュにない場合は生成してキャッシュに保存
        const photoBuf = await sharp(photoPath)
          .resize(width)
          .webp({ quality: 80 }) // WebPに変換（ファイルサイズ削減）
          .toBuffer();

        // 非同期でキャッシュに保存（レスポンスを遅らせない）
        // エラーは saveThumbnailToCache 内部でログ出力される
        void saveThumbnailToCache(cacheKey, photoBuf);

        return `data:image/webp;base64,${photoBuf.toString('base64')}`;
      }

      // 元サイズの場合はキャッシュなし
      const photoBuf = await sharp(photoPath).toBuffer();
      return `data:image/${path
        .extname(photoPath)
        .replace('.', '')};base64,${photoBuf.toString('base64')}`;
    })(),
    (error): 'InputFileIsMissing' => {
      return match(error)
        .with(
          P.intersection(P.instanceOf(Error), {
            message: P.string.includes('Input file is missing'),
          }),
          () => 'InputFileIsMissing' as const,
        )
        .otherwise((e) => {
          // 予期しないエラーはre-throw（Sentryに送信）
          throw e instanceof Error ? e : new Error(JSON.stringify(e));
        });
    },
  );
};

/**
 * データベース内で最新の写真日時を取得する
 * ログ同期の開始位置判定に用いる
 */
export const getLatestPhotoDate = async (): Promise<Date | null> => {
  const latestPhoto = await model.getLatestVRChatPhoto();
  return latestPhoto?.photoTakenAt ?? null;
};

/**
 * 軽量メタデータのみ取得する（初回クエリ用）
 * photoPath を含まないことでメモリ使用量を大幅に削減
 *
 * 使用例:
 * - 写真10万枚の場合、通常取得: ~19.3MB → 軽量取得: ~5MB (約74%削減)
 */
export const getVRChatPhotoMetadataList = async (query?: {
  gtPhotoTakenAt?: Date;
  ltPhotoTakenAt?: Date;
  orderByPhotoTakenAt: 'asc' | 'desc';
}) => {
  return model.getVRChatPhotoMetadataList(query);
};

/**
 * 指定されたIDの写真パスをオンデマンドでバッチ取得
 * 表示に必要な範囲のみ取得することでメモリ使用量を削減
 *
 * @param ids 取得したい写真のIDリスト
 * @returns Map<id, photoPath>
 */
export const getVRChatPhotoPathsByIds = async (ids: string[]) => {
  return model.getVRChatPhotoPathsByIds(ids);
};

/**
 * バッチサムネイル取得の結果
 */
export interface BatchThumbnailResult {
  /** 成功したサムネイル（photoPath -> base64Data） */
  success: Map<string, string>;
  /** 失敗したパスと理由 */
  failed: Array<{
    photoPath: string;
    reason: 'file_not_found' | 'unexpected_error';
    message: string;
  }>;
}

/**
 * 複数のサムネイルをバッチ取得（Google Photos風の高速ローディング）
 *
 * 個別リクエストではなくバッチで取得することで:
 * - ネットワークオーバーヘッド削減
 * - 並列処理による高速化
 *
 * @param photoPaths 取得したい写真のパスリスト
 * @param width サムネイルの幅（デフォルト: 256px）
 * @returns 成功したサムネイルと失敗情報を含む構造化された結果
 */
export const getBatchThumbnails = async (
  photoPaths: string[],
  width = 256,
): Promise<BatchThumbnailResult> => {
  const success = new Map<string, string>();
  const failed: BatchThumbnailResult['failed'] = [];
  const PARALLEL_LIMIT = 8; // 並列処理数を制限

  // 並列処理数を制限しながらバッチ処理
  for (let i = 0; i < photoPaths.length; i += PARALLEL_LIMIT) {
    const batch = photoPaths.slice(i, i + PARALLEL_LIMIT);

    const thumbnailPromises = batch.map(async (photoPath) => {
      // getVRChatPhotoItemData は予期しないエラーを throw するため
      // allSettled で個別にハンドリングする
      const result = await getVRChatPhotoItemData({ photoPath, width });
      return { photoPath, result };
    });

    // Promise.allSettled で1ファイルの失敗が全体を止めないようにする
    const settledResults = await Promise.allSettled(thumbnailPromises);

    for (const settled of settledResults) {
      if (settled.status === 'fulfilled') {
        const { photoPath, result } = settled.value;
        result.match(
          (data) => success.set(photoPath, data),
          (error) =>
            failed.push({
              photoPath,
              reason: 'file_not_found',
              message: error,
            }),
        );
      } else {
        // 予期しないエラー（sharp内部エラー等）をログ出力
        // Sentryに送信されるのは logger.error() 経由
        const errorMessage =
          settled.reason instanceof Error
            ? settled.reason.message
            : String(settled.reason);
        logger.error({
          message: 'Unexpected error during batch thumbnail fetch',
          stack:
            settled.reason instanceof Error
              ? settled.reason
              : new Error(errorMessage),
        });
        // rejected の場合は photoPath を特定できないが、バッチ処理は継続
      }
    }
  }

  // 失敗があった場合はサマリーログを出力
  if (failed.length > 0) {
    logger.info({
      message: `Batch thumbnail fetch completed with failures`,
      details: {
        totalRequested: photoPaths.length,
        successCount: success.size,
        failedCount: failed.length,
      },
    });
  }

  return { success, failed };
};
