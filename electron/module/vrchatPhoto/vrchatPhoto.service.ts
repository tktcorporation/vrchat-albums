import * as crypto from 'node:crypto';
import * as fsPromises from 'node:fs/promises';
import * as os from 'node:os';
import { performance } from 'node:perf_hooks';
import * as dateFns from 'date-fns';
import { glob } from 'glob';
import * as neverthrow from 'neverthrow';
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
 * Electronのappモジュールを遅延取得する
 * Playwrightテスト時のクラッシュを防ぐため、トップレベルインポートを避ける
 */
const getElectronApp = (): typeof import('electron').app | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron') as typeof import('electron');
    return app;
  } catch (error) {
    // Playwrightテストなど非Electron環境では予期されるエラー
    logger.debug({
      message: 'Electron app module not available, using fallback paths',
      stack: error instanceof Error ? error : new Error(String(error)),
    });
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
    } catch (error) {
      // アプリ未初期化時はフォールバック
      logger.debug({
        message: 'app.getPath("temp") failed, using os.tmpdir() fallback',
        stack: error instanceof Error ? error : new Error(String(error)),
      });
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
 * @returns Result<cacheDir, CacheDirError> - 成功時はディレクトリパス、失敗時はエラー
 */
const ensureCacheDir = async (): Promise<
  neverthrow.Result<string, CacheDirError>
> => {
  const cacheDir = getThumbnailCacheDir();
  try {
    await fsPromises.mkdir(cacheDir, { recursive: true });
    return neverthrow.ok(cacheDir);
  } catch (error) {
    // ディレクトリが既に存在する場合は成功
    return match(error)
      .with({ code: 'EEXIST' }, () => neverthrow.ok(cacheDir))
      .otherwise((e) => {
        const errorCode = (e as NodeJS.ErrnoException).code;
        logger.error({
          message: `Failed to create cache directory: ${cacheDir}`,
          stack: e instanceof Error ? e : new Error(String(e)),
        });
        return neverthrow.err({
          type: 'CACHE_DIR_CREATION_FAILED' as const,
          message: `Cannot create cache directory: ${cacheDir}`,
          code: errorCode,
        });
      });
  }
};

/**
 * キャッシュからサムネイルを取得
 *
 * @returns キャッシュヒット時はBuffer、キャッシュミスまたはキャッシュ無効時はnull
 */
const getCachedThumbnail = async (cacheKey: string): Promise<Buffer | null> => {
  const cacheDirResult = await ensureCacheDir();
  if (cacheDirResult.isErr()) {
    // キャッシュディレクトリが利用不可の場合はキャッシュミスとして扱う
    logger.debug({
      message: 'Cache directory unavailable, skipping cache lookup',
      stack: new Error(cacheDirResult.error.message),
    });
    return null;
  }

  const cachePath = path.join(cacheDirResult.value, `${cacheKey}.webp`);

  try {
    const stats = await fsPromises.stat(cachePath);
    // キャッシュが有効期限を超えている場合は無効
    const cacheDate = new Date(stats.mtimeMs);
    const expiryDate = dateFns.subDays(new Date(), CACHE_EXPIRY_DAYS);
    if (cacheDate < expiryDate) {
      return null;
    }
    return await fsPromises.readFile(cachePath);
  } catch (error) {
    // 予期されたエラー（ファイル不在）と予期しないエラーを分類
    return match(error)
      .with({ code: 'ENOENT' }, () => null) // ファイルがない場合はキャッシュミス
      .otherwise((e) => {
        // 予期しないエラー（権限エラー、I/Oエラー等）はログ出力
        logger.warn({
          message: `Unexpected error reading cached thumbnail: ${cachePath}`,
          stack: e instanceof Error ? e : new Error(String(e)),
        });
        return null;
      });
  }
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

  try {
    const files = await fsPromises.readdir(cacheDir);
    const fileStats = await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(cacheDir, file);
        try {
          const stats = await fsPromises.stat(filePath);
          return { filePath, stats, size: stats.size, mtime: stats.mtimeMs };
        } catch (error) {
          // ENOENT はレースコンディション（ファイル削除）で予期される
          // その他のエラー（権限、I/O）はログ出力
          return match(error)
            .with({ code: 'ENOENT' }, () => null)
            .otherwise((e) => {
              logger.debug({
                message: `Failed to stat cache file: ${filePath}`,
                stack: e instanceof Error ? e : new Error(String(e)),
              });
              return null;
            });
        }
      }),
    );

    const validFiles = fileStats.filter(
      (f): f is NonNullable<typeof f> => f !== null,
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
      try {
        await fsPromises.unlink(file.filePath);
        currentSize -= file.size / 1024 / 1024;
      } catch (error) {
        // 削除失敗をログ出力（処理は継続）
        logger.warn({
          message: `Failed to delete cache file during cleanup: ${file.filePath}`,
          stack: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }

    logger.info(
      `Thumbnail cache cleanup completed. New size: ${currentSize.toFixed(2)}MB`,
    );
  } catch (error) {
    logger.error({
      message: 'Failed to cleanup thumbnail cache',
      stack: error instanceof Error ? error : new Error(String(error)),
    });
  }
};

/**
 * VRChat の写真が保存されている場所のデフォルト値を取得する
 */
const getDefaultVRChatPhotoDir = (): VRChatPhotoDirPath => {
  // /workspaces/vrchat-albums/debug/photos/VRChat
  // return path.join('/workspaces/vrchat-albums/debug/photos');
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
      try {
        const stats = await fsPromises.stat(photoPathStr);
        if (stats.mtime <= lastProcessedDate) {
          continue; // 古いファイルはスキップ
        }
      } catch (error) {
        logger.error({
          message: `Failed to get stats for ${photoPathStr}`,
          stack: error instanceof Error ? error : new Error(String(error)),
        });
        continue;
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

      try {
        const takenAt = dateFns.parse(
          matchResult[1],
          'yyyy-MM-dd_HH-mm-ss.SSS',
          new Date(),
        );

        // sharpインスタンスを使い捨てにしてメモリリークを防ぐ
        const metadata = await sharp(photoPath).metadata();
        const height = metadata.height ?? 720;
        const width = metadata.width ?? 1280;

        return {
          photoPath,
          takenAt,
          width,
          height,
        };
      } catch (error) {
        logger.error({
          message: `Failed to process photo metadata for ${photoPath}`,
          stack: error instanceof Error ? error : new Error(String(error)),
        });
        return null;
      }
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
  try {
    // サムネイル（width指定あり）の場合はキャッシュを使用
    if (width !== undefined) {
      const cacheKey = generateCacheKey(photoPath, width);

      // キャッシュから取得を試みる
      const cachedBuffer = await getCachedThumbnail(cacheKey);
      if (cachedBuffer) {
        return neverthrow.ok(
          `data:image/webp;base64,${cachedBuffer.toString('base64')}`,
        );
      }

      // キャッシュにない場合は生成してキャッシュに保存
      const photoBuf = await sharp(photoPath)
        .resize(width)
        .webp({ quality: 80 }) // WebPに変換（ファイルサイズ削減）
        .toBuffer();

      // 非同期でキャッシュに保存（レスポンスを遅らせない）
      // エラーは saveThumbnailToCache 内部でログ出力される
      void saveThumbnailToCache(cacheKey, photoBuf);

      return neverthrow.ok(
        `data:image/webp;base64,${photoBuf.toString('base64')}`,
      );
    }

    // 元サイズの場合はキャッシュなし
    const photoBuf = await sharp(photoPath).toBuffer();
    return neverthrow.ok(
      `data:image/${path
        .extname(photoPath)
        .replace('.', '')};base64,${photoBuf.toString('base64')}`,
    );
  } catch (error) {
    return match(error)
      .with(
        P.intersection(P.instanceOf(Error), {
          message: P.string.includes('Input file is missing'),
        }),
        () => neverthrow.err('InputFileIsMissing' as const),
      )
      .otherwise((e) => {
        // 予期しないエラーはre-throw（Sentryに送信）
        throw e instanceof Error ? e : new Error(JSON.stringify(e));
      });
  }
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
 * 軽量メタデータのみ取得する（ハイブリッドローディング Phase 1）
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
 * 指定されたIDの写真パスをバッチ取得（ハイブリッドローディング Phase 2）
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
      try {
        const result = await getVRChatPhotoItemData({ photoPath, width });
        if (result.isOk()) {
          return {
            photoPath,
            data: result.value,
            error: null as null,
          };
        }
        // Result.isErr() の場合
        return {
          photoPath,
          data: null as null,
          error: {
            reason: 'file_not_found' as const,
            message: result.error,
          },
        };
      } catch (error) {
        // 予期しないエラーをログ出力（バッチ処理は継続、Sentryに送信）
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error({
          message: `Failed to get thumbnail in batch for ${photoPath}`,
          stack: error instanceof Error ? error : new Error(errorMessage),
        });
        return {
          photoPath,
          data: null as null,
          error: {
            reason: 'unexpected_error' as const,
            message: errorMessage,
          },
        };
      }
    });

    const batchResults = await Promise.all(thumbnailPromises);
    for (const { photoPath, data, error } of batchResults) {
      if (data) {
        success.set(photoPath, data);
      } else if (error) {
        failed.push({
          photoPath,
          reason: error.reason,
          message: error.message,
        });
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
