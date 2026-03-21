import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as neverthrow from 'neverthrow';
import * as path from 'pathe';
import { match } from 'ts-pattern';
import { VRChatWorldIdSchema } from '../../lib/brandedTypes';
import { logger } from '../../lib/logger';
import type { ImageGenerationError } from '../imageGenerator/error';
import { generateWorldJoinImage } from '../imageGenerator/service';
import { emitProgress, emitStageStart } from '../initProgress/emitter';
import { getVrcWorldInfoByWorldId } from '../vrchatApi/service';
import { findVRChatWorldJoinLogList } from '../vrchatWorldJoinLog/service';
import { generateWorldJoinImagePath } from './fileNaming';

/**
 * 並行実行防止用ミューテックス
 *
 * 背景: syncLogs が前回の画像生成完了前に再実行された場合、
 * 二重実行による重複ファイル作成や API レート制限超過を防ぐ。
 */
let isGenerating = false;

/** テスト用: ミューテックス状態をリセット */
export const _resetGeneratingFlag = (): void => {
  isGenerating = false;
};

interface GenerationResult {
  generated: number;
  skipped: number;
  errors: number;
}

/**
 * 未生成の World Join 画像を一括生成する
 *
 * 背景: syncLogs 完了後に呼ばれ、DB の World Join ログと
 * ファイルシステムの存在チェックで差分を検出して画像を生成する。
 * API レート制限回避のため 1 秒間隔でリクエストを送信する。
 *
 * 呼び出し元: logSync/service.ts（syncLogs 完了後に fire-and-forget）
 */
export const generateMissingWorldJoinImages = async (params: {
  photoDirPath: string;
}): Promise<neverthrow.Result<GenerationResult, ImageGenerationError>> => {
  if (isGenerating) {
    logger.info('World join image generation already in progress, skipping');
    return neverthrow.ok({ generated: 0, skipped: 0, errors: 0 });
  }

  if (!params.photoDirPath) {
    return neverthrow.ok({ generated: 0, skipped: 0, errors: 0 });
  }

  isGenerating = true;
  try {
    return await generateMissingWorldJoinImagesInternal(params);
  } finally {
    isGenerating = false;
  }
};

/**
 * 内部実装: ミューテックスで保護された画像生成処理
 */
const generateMissingWorldJoinImagesInternal = async (params: {
  photoDirPath: string;
}): Promise<neverthrow.Result<GenerationResult, ImageGenerationError>> => {
  const { photoDirPath } = params;

  // 1. DB から World Join ログを取得
  const joins = await findVRChatWorldJoinLogList({
    orderByJoinDateTime: 'desc',
  });

  // 2. 未生成のものをフィルタ（ファイル存在チェック）
  const missingJoins = joins.filter((join) => {
    const imagePath = generateWorldJoinImagePath(
      photoDirPath,
      join.joinDateTime,
      join.worldId,
    );
    return !fs.existsSync(imagePath);
  });

  if (missingJoins.length === 0) {
    return neverthrow.ok({ generated: 0, skipped: joins.length, errors: 0 });
  }

  logger.info(`Found ${missingJoins.length} world joins without images`);
  emitStageStart(
    'world_join_image',
    `Generating world join images (${missingJoins.length})...`,
  );

  let generated = 0;
  let errors = 0;

  for (const [index, join] of missingJoins.entries()) {
    // API レート制限回避: 1 秒間隔でリクエスト
    if (index > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    try {
      // 3. VRChat API でワールド情報取得
      // DB の worldId は string 型だが、API は VRChatWorldId (branded type) を要求する
      const parsedWorldId = VRChatWorldIdSchema.safeParse(join.worldId);
      if (!parsedWorldId.success) {
        logger.warn(`Invalid world ID format: ${join.worldId}`);
        errors++;
        continue;
      }
      const worldInfoResult = await getVrcWorldInfoByWorldId(
        parsedWorldId.data,
      );
      if (worldInfoResult.isErr()) {
        logger.warn(
          `Failed to get world info for ${join.worldId}: ${worldInfoResult.error.type}`,
        );
        errors++;
        continue;
      }

      const worldInfo = worldInfoResult.value;

      // 4. ワールド画像をダウンロード → base64
      const { ofetch } = await import('ofetch');
      let imageResponse: ArrayBuffer;
      try {
        imageResponse = await ofetch(worldInfo.imageUrl, {
          responseType: 'arrayBuffer',
          timeout: 30_000,
        });
      } catch (downloadError) {
        logger.warn({
          message: `Failed to download world image for ${join.worldId}`,
          stack:
            downloadError instanceof Error
              ? downloadError
              : new Error(String(downloadError)),
        });
        errors++;
        continue;
      }

      const imageBase64 = Buffer.from(imageResponse).toString('base64');

      // 5. 画像生成（プレイヤー一覧は将来的に対応予定）
      const imageResult = await generateWorldJoinImage({
        worldName: worldInfo.name,
        imageBase64,
        players: null,
        joinDateTime: join.joinDateTime,
      });

      if (imageResult.isErr()) {
        logger.warn(
          `Failed to generate image for ${join.worldId}: ${imageResult.error.type}`,
        );
        errors++;
        continue;
      }

      // 6. ファイル保存
      const outputPath = generateWorldJoinImagePath(
        photoDirPath,
        join.joinDateTime,
        join.worldId,
      );
      const outputDir = path.dirname(outputPath);
      await fsPromises.mkdir(outputDir, { recursive: true });
      await fsPromises.writeFile(outputPath, imageResult.value);

      generated++;
      emitProgress({
        stage: 'world_join_image',
        progress: Math.round(((index + 1) / missingJoins.length) * 100),
        message: `Generated ${generated}/${missingJoins.length} images`,
      });
    } catch (error) {
      // エラー分類: 予期されたエラー（ネットワーク/ファイルI/O）はログして続行
      // 予期しないエラー（TypeError 等）は Sentry に送信
      const isExpectedError =
        error instanceof Error &&
        ('code' in error ||
          error.name === 'FetchError' ||
          error.name === 'AbortError');

      match(isExpectedError)
        .with(true, () => {
          logger.warn({
            message: `Expected error generating world join image for ${join.worldId}: ${error instanceof Error ? error.message : String(error)}`,
            stack: error instanceof Error ? error : new Error(String(error)),
          });
        })
        .with(false, () => {
          logger.error({
            message: `Unexpected error generating world join image for ${join.worldId}`,
            stack: error instanceof Error ? error : new Error(String(error)),
          });
        })
        .exhaustive();
      errors++;
    }
  }

  logger.info(
    `World join image generation complete: ${generated} generated, ${errors} errors`,
  );
  return neverthrow.ok({
    generated,
    skipped: joins.length - missingJoins.length,
    errors,
  });
};
