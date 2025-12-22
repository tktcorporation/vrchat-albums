import * as fsPromises from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import * as dateFns from 'date-fns';
import { app } from 'electron';
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

/**
 * VRChat の写真が保存されている場所のデフォルト値を取得する
 */
const getDefaultVRChatPhotoDir = (): VRChatPhotoDirPath => {
  // /workspaces/vrchat-albums/debug/photos/VRChat
  // return path.join('/workspaces/vrchat-albums/debug/photos');
  const logFilesDir =
    process.platform === 'win32' && process.env.USERPROFILE
      ? path.join(app.getPath('pictures') || '', 'VRChat')
      : path.join(process.env.HOME || '', 'Pictures', 'VRChat');

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
const PHOTO_PATH_BATCH_SIZE = 1000; // パスの取得用（stat情報のチェック）
const PHOTO_METADATA_BATCH_SIZE = 100; // メタデータ取得用（sharp処理は重いため小さく）

/**
 * 写真パスをバッチごとに取得するジェネレータ関数
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
  const allPhotoPathList = await glob(`${normalizedTargetDir}/**/VRChat_*.png`);

  let targetPhotoPathList: string[];
  if (lastProcessedDate) {
    // バッチ処理でstat情報を取得
    const filteredPaths: string[] = [];
    for (let i = 0; i < allPhotoPathList.length; i += PHOTO_PATH_BATCH_SIZE) {
      const batch = allPhotoPathList.slice(i, i + PHOTO_PATH_BATCH_SIZE);
      const statsPromises = batch.map(async (photoPath) => {
        try {
          const stats = await fsPromises.stat(photoPath);
          return { photoPath, stats };
        } catch (error) {
          logger.error({
            message: `Failed to get stats for ${photoPath}`,
            stack: error instanceof Error ? error : new Error(String(error)),
          });
          return null;
        }
      });

      const statsResults = (await Promise.all(statsPromises)).filter(
        (result): result is NonNullable<typeof result> => result !== null,
      );

      filteredPaths.push(
        ...statsResults
          .filter((r) => r.stats.mtime > lastProcessedDate)
          .map((r) => r.photoPath),
      );
    }
    targetPhotoPathList = filteredPaths;
  } else {
    targetPhotoPathList = allPhotoPathList;
  }

  // メタデータ処理用の小さいバッチサイズでyield
  for (
    let i = 0;
    i < targetPhotoPathList.length;
    i += PHOTO_METADATA_BATCH_SIZE
  ) {
    yield targetPhotoPathList.slice(i, i + PHOTO_METADATA_BATCH_SIZE);
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
 */
export const getVRChatPhotoPathList = async (query?: {
  gtPhotoTakenAt?: Date;
  ltPhotoTakenAt?: Date;
  orderByPhotoTakenAt: 'asc' | 'desc';
}) => {
  return model.getVRChatPhotoPathList(query);
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
    const photoBuf = await sharp(photoPath)
      .resize(width ?? undefined)
      .toBuffer();
    return neverthrow.ok(
      `data:image/${path
        .extname(photoPath)
        .replace('.', '')};base64,${photoBuf.toString('base64')}`,
    );
  } catch (error) {
    if (!(error instanceof Error)) {
      throw new Error(JSON.stringify(error));
    }
    return neverthrow.err(
      match(error.message)
        .with(
          P.string.includes('Input file is missing'),
          () => 'InputFileIsMissing' as const,
        )
        .with(P.string, () => {
          throw error;
        })
        .exhaustive(),
    );
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
