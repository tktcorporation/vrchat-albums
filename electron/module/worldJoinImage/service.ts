import * as fsPromises from 'node:fs/promises';
import { Effect } from 'effect';
import * as path from 'pathe';
import { match, P } from 'ts-pattern';
import { VRChatWorldIdSchema } from '../../lib/brandedTypes';
import { logger } from '../../lib/logger';
import type { ImageGenerationError } from '../imageGenerator/errors';
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
export const generateMissingWorldJoinImages = (params: {
  photoDirPath: string;
}): Effect.Effect<GenerationResult, ImageGenerationError> => {
  if (isGenerating) {
    logger.info('World join image generation already in progress, skipping');
    return Effect.succeed({ generated: 0, skipped: 0, errors: 0 });
  }

  if (!params.photoDirPath) {
    return Effect.succeed({ generated: 0, skipped: 0, errors: 0 });
  }

  isGenerating = true;
  return Effect.ensuring(
    generateMissingWorldJoinImagesInternal(params),
    Effect.sync(() => {
      isGenerating = false;
    }),
  );
};

/**
 * 内部実装: ミューテックスで保護された画像生成処理
 *
 * 内部でエラーをハンドリングして continue するため、
 * Effect.promise で全体をラップする。予期しないエラーは throw で Sentry 送信。
 */
const generateMissingWorldJoinImagesInternal = (params: {
  photoDirPath: string;
}): Effect.Effect<GenerationResult, ImageGenerationError> =>
  Effect.promise(async (): Promise<GenerationResult> => {
    const { photoDirPath } = params;

    // 1. DB から World Join ログを取得
    const joins = await findVRChatWorldJoinLogList({
      orderByJoinDateTime: 'desc',
    });

    // 2. 未生成のものをフィルタ（非同期ファイル存在チェック）
    const existenceChecks = await Promise.all(
      joins.map(async (join) => {
        const imagePath = generateWorldJoinImagePath(
          photoDirPath,
          join.joinDateTime,
          join.worldId,
        );
        try {
          await fsPromises.access(imagePath);
          return { join, exists: true };
        } catch {
          return { join, exists: false };
        }
      }),
    );
    const missingJoins = existenceChecks
      .filter((check) => !check.exists)
      .map((check) => check.join);

    if (missingJoins.length === 0) {
      return { generated: 0, skipped: joins.length, errors: 0 };
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
        const worldInfoExit = await Effect.runPromiseExit(
          getVrcWorldInfoByWorldId(parsedWorldId.data),
        );
        if (worldInfoExit._tag === 'Failure') {
          logger.warn(`Failed to get world info for ${join.worldId}`);
          errors++;
          continue;
        }

        const worldInfo = worldInfoExit.value;

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
        const imageExit = await Effect.runPromiseExit(
          generateWorldJoinImage({
            worldName: worldInfo.name,
            imageBase64,
            players: null,
            joinDateTime: join.joinDateTime,
          }),
        );

        if (imageExit._tag === 'Failure') {
          logger.warn(`Failed to generate image for ${join.worldId}`);
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
        await fsPromises.writeFile(outputPath, imageExit.value);

        generated++;
        emitProgress({
          stage: 'world_join_image',
          progress: Math.round(((index + 1) / missingJoins.length) * 100),
          message: `Generated ${generated}/${missingJoins.length} images`,
        });
      } catch (error) {
        // エラー分類: 予期されたエラー（ネットワーク/ファイルI/O）はログして続行
        // 予期しないエラー（TypeError 等）は re-throw して Sentry に送信
        match(error)
          .with(
            P.instanceOf(Error).and(
              P.union(
                { name: 'FetchError' },
                { name: 'AbortError' },
                { code: P.union('ENOENT', 'EACCES', 'EPERM', 'ETIMEDOUT') },
              ),
            ),
            (e) => {
              logger.warn({
                message: `Expected error generating world join image for ${join.worldId}: ${e.message}`,
                stack: e,
              });
              errors++;
            },
          )
          .otherwise((e) => {
            throw e;
          });
      }
    }

    logger.info(
      `World join image generation complete: ${generated} generated, ${errors} errors`,
    );
    return {
      generated,
      skipped: joins.length - missingJoins.length,
      errors,
    };
  });
