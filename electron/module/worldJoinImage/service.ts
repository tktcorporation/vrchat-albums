import * as fsPromises from 'node:fs/promises';

import * as datefns from 'date-fns';
import { Effect } from 'effect';
import * as path from 'pathe';
import { match, P } from 'ts-pattern';

import { VRChatWorldIdSchema } from '../../lib/brandedTypes';
import { logger } from '../../lib/logger';
import { setExifToBuffer } from '../../lib/wrappedExifTool';
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
 * ループ1回分の画像生成処理
 *
 * 背景: 個別の World Join に対して API 取得 → 画像ダウンロード → 画像生成 → ファイル保存を行う。
 * 各ステップの失敗は Effect.either で検出し、呼び出し側でスキップ判断する。
 * ファイル I/O エラー（ENOENT, EACCES 等）は ts-pattern で分類し、
 * 予期しないエラー（TypeError 等）は defect として再スローする。
 */
const generateSingleWorldJoinImage = (
  join: { worldId: string; joinDateTime: Date },
  photoDirPath: string,
): Effect.Effect<
  void,
  { type: 'SKIPPABLE_ERROR'; worldId: string; message: string }
> =>
  Effect.gen(function* () {
    // 3. VRChat API でワールド情報取得
    // DB の worldId は string 型だが、API は VRChatWorldId (branded type) を要求する
    const parsedWorldId = VRChatWorldIdSchema.safeParse(join.worldId);
    if (!parsedWorldId.success) {
      return yield* Effect.fail({
        type: 'SKIPPABLE_ERROR' as const,
        worldId: join.worldId,
        message: `Invalid world ID format: ${join.worldId}`,
      });
    }

    const worldInfo = yield* getVrcWorldInfoByWorldId(parsedWorldId.data).pipe(
      Effect.mapError(
        () =>
          ({
            type: 'SKIPPABLE_ERROR' as const,
            worldId: join.worldId,
            message: `Failed to get world info for ${join.worldId}`,
          }) as const,
      ),
    );

    // 4. ワールド画像をダウンロード → base64
    // User-Agent ヘッダーを付与する（convertImageToBase64 と同じ方式）
    const { ofetch } = yield* Effect.promise(() => import('ofetch'));
    const userAgent = `Electron ${process.versions.electron}; ${process.platform}; ${process.arch}`;
    const imageResponse = yield* Effect.tryPromise({
      try: () =>
        ofetch(worldInfo.imageUrl, {
          headers: { 'User-Agent': userAgent },
          responseType: 'arrayBuffer',
          timeout: 30_000,
        }),
      catch: (error) =>
        ({
          type: 'SKIPPABLE_ERROR' as const,
          worldId: join.worldId,
          message: `Failed to download world image for ${join.worldId}: ${error instanceof Error ? error.message : String(error)}`,
        }) as const,
    });

    const imageBase64 = Buffer.from(imageResponse).toString('base64');

    // 5. 画像生成（プレイヤー一覧は将来的に対応予定）
    const rawImageBuffer = yield* generateWorldJoinImage({
      worldName: worldInfo.name,
      imageBase64,
      players: null,
      joinDateTime: join.joinDateTime,
    }).pipe(
      Effect.mapError(
        () =>
          ({
            type: 'SKIPPABLE_ERROR' as const,
            worldId: join.worldId,
            message: `Failed to generate image for ${join.worldId}`,
          }) as const,
      ),
    );

    // 5.5. EXIF メタデータを埋め込む
    // 背景: vrchat-join-recorder と同様に、生成画像に撮影日時・ワールド情報を
    // EXIF として記録する。写真管理ソフトでの日時ソートやメタデータ表示に必要。
    const imageBuffer = yield* setExifToBuffer(rawImageBuffer, {
      description: worldInfo.name,
      dateTimeOriginal: datefns.format(
        join.joinDateTime,
        'yyyy:MM:dd HH:mm:ss',
      ),
      timezoneOffset: datefns.format(join.joinDateTime, 'xxx'),
    }).pipe(
      Effect.mapError(
        () =>
          ({
            type: 'SKIPPABLE_ERROR' as const,
            worldId: join.worldId,
            message: `Failed to set EXIF data for ${join.worldId}`,
          }) as const,
      ),
    );

    // 6. ファイル保存
    // ファイル I/O エラーは ts-pattern で分類し、予期されたエラーのみスキップ対象にする
    const outputPath = generateWorldJoinImagePath(
      photoDirPath,
      join.joinDateTime,
      join.worldId,
    );
    const outputDir = path.dirname(outputPath);
    yield* Effect.tryPromise({
      try: async () => {
        await fsPromises.mkdir(outputDir, { recursive: true });
        await fsPromises.writeFile(outputPath, imageBuffer);
      },
      catch: (error) =>
        match(error)
          .with(
            P.instanceOf(Error).and(
              P.union(
                { name: 'FetchError' },
                { name: 'AbortError' },
                {
                  code: P.union('ENOENT', 'EACCES', 'EPERM', 'ETIMEDOUT'),
                },
              ),
            ),
            (e) =>
              ({
                type: 'SKIPPABLE_ERROR' as const,
                worldId: join.worldId,
                message: `Expected error generating world join image for ${join.worldId}: ${e.message}`,
              }) as const,
          )
          .otherwise((e) => {
            // 予期しないエラー（TypeError 等）は defect として再スロー → Sentry 送信
            throw e;
          }),
    });
  });

/**
 * 内部実装: ミューテックスで保護された画像生成処理
 *
 * 各 World Join の画像生成を Effect.either で個別にハンドリングし、
 * 予期されたエラーはスキップして次の Join に進む（部分的成功パターン）。
 * 予期しないエラーは generateSingleWorldJoinImage 内で defect として再スローされる。
 */
const generateMissingWorldJoinImagesInternal = (params: {
  photoDirPath: string;
}): Effect.Effect<GenerationResult, ImageGenerationError> =>
  Effect.gen(function* () {
    const { photoDirPath } = params;

    // 1. DB から World Join ログを取得
    const joins = yield* Effect.promise(() =>
      findVRChatWorldJoinLogList({
        orderByJoinDateTime: 'desc',
      }),
    );

    // 2. 未生成のものをフィルタ（非同期ファイル存在チェック）
    const existenceChecks = yield* Effect.promise(() =>
      Promise.all(
        joins.map(async (join) => {
          const imagePath = generateWorldJoinImagePath(
            photoDirPath,
            join.joinDateTime,
            join.worldId,
          );
          const exists = await fsPromises
            .access(imagePath)
            .then(() => true)
            .catch(() => false);
          return { join, exists };
        }),
      ),
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
        yield* Effect.promise(
          () => new Promise((resolve) => setTimeout(resolve, 1000)),
        );
      }

      // 部分的成功パターン: Effect.either で個別エラーをハンドリング
      const result = yield* Effect.either(
        generateSingleWorldJoinImage(join, photoDirPath),
      );

      if (result._tag === 'Left') {
        logger.warn(result.left.message);
        errors++;
        continue;
      }

      generated++;
      emitProgress({
        stage: 'world_join_image',
        progress: Math.round(((index + 1) / missingJoins.length) * 100),
        message: `Generated ${generated}/${missingJoins.length} images`,
      });
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
