import { Cause, Effect, Exit, Option } from 'effect';
import z from 'zod';

import { runEffect } from '../../lib/effectTRPC';
import { toUserFacing } from '../../lib/errorMapping';
import { ERROR_CATEGORIES, ERROR_CODES } from '../../lib/errors';
import { logger } from './../../lib/logger';
import { eventEmitter, procedure, router as trpcRouter } from './../../trpc';
import * as utilsService from './../electronUtil/service';
import * as vrchatPhotoService from './../vrchatPhoto/vrchatPhoto.service';
import { VRChatPhotoDirPathSchema } from './valueObjects';

/**
 * 写真ファイルが見つからないエラー → UserFacingError 変換。
 */
const mapPhotoNotFoundError = toUserFacing({
  code: ERROR_CODES.FILE_NOT_FOUND,
  category: ERROR_CATEGORIES.FILE_NOT_FOUND,
  userMessage: '写真ファイルが見つかりません。',
});

/**
 * index 済みの写真ファイルのpath一覧を取得する
 * ページネーション対応でメモリ使用量を抑える
 */
const getVRChatLogFilePathModelList = async (query?: {
  gtPhotoTakenAt?: Date;
  ltPhotoTakenAt?: Date;
  orderByPhotoTakenAt: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}) => {
  const vrchatPhotoPathList =
    await vrchatPhotoService.getVRChatPhotoPathList(query);
  return vrchatPhotoPathList.map((photoPathModel) => ({
    id: photoPathModel.id,
    photoPath: photoPathModel.photoPath,
    width: photoPathModel.width,
    height: photoPathModel.height,
    photoTakenAt: photoPathModel.photoTakenAt,
  }));
};

const getCountByYearMonthList = async () => {
  const countByYearMonthList =
    await vrchatPhotoService.getCountByYearMonthList();
  return countByYearMonthList;
};

const setVRChatPhotoDirPathByDialog = async (): Promise<'ok' | 'canceled'> => {
  const exit = await Effect.runPromiseExit(
    utilsService
      .openElectronDialog(['openDirectory'])
      .pipe(Effect.map((paths) => paths[0])),
  );
  if (Exit.isSuccess(exit)) {
    vrchatPhotoService.setVRChatPhotoDirPathToSettingStore(
      VRChatPhotoDirPathSchema.parse(exit.value),
    );
    return 'ok';
  }
  // canceled
  return 'canceled';
};

export const vrchatPhotoRouter = () =>
  trpcRouter({
    getVRChatPhotoDirPath: procedure.query(() => {
      return vrchatPhotoService.getVRChatPhotoDirPath();
    }),
    setVRChatPhotoDirPathToSettingStore: procedure.mutation(async () => {
      const dialogResult = await setVRChatPhotoDirPathByDialog();
      if (dialogResult === 'ok') {
        eventEmitter.emit('toast', 'VRChatの写真の保存先を設定しました');
        return true;
      }
      eventEmitter.emit('toast', 'canceled');
      return false;
    }),
    clearVRChatPhotoDirPathInSettingStore: procedure.mutation(() => {
      return vrchatPhotoService.clearVRChatPhotoDirPathInSettingStore();
    }),
    setVRChatPhotoDirPathDirectly: procedure
      .input(z.string().min(1, 'パスを入力してください'))
      .mutation(async ({ input: photoPath }) => {
        vrchatPhotoService.setVRChatPhotoDirPathToSettingStore(
          VRChatPhotoDirPathSchema.parse(photoPath),
        );
        eventEmitter.emit('toast', 'VRChatの写真の保存先を設定しました');
        return true;
      }),
    getVrchatPhotoPathModelList: procedure
      .input(
        z
          .object({
            gtPhotoTakenAt: z.date().optional(),
            ltPhotoTakenAt: z.date().optional(),
            orderByPhotoTakenAt: z.enum(['asc', 'desc']),
            limit: z.number().int().positive().max(5000).optional(),
            offset: z.number().int().nonnegative().optional(),
          })
          .optional(),
      )
      .query(async (ctx) => {
        return getVRChatLogFilePathModelList(ctx.input);
      }),
    getVrchatPhotoPathCount: procedure
      .input(
        z
          .object({
            gtPhotoTakenAt: z.date().optional(),
            ltPhotoTakenAt: z.date().optional(),
          })
          .optional(),
      )
      .query(async (ctx) => {
        // サービス関数は予期されたエラーを返さない
        // データベースエラーなどの予期しないエラーはthrowされてSentryに送信される
        return vrchatPhotoService.getVRChatPhotoPathCount(ctx.input);
      }),
    getCountByYearMonthList: procedure.query(async () => {
      return getCountByYearMonthList();
    }),
    getVRChatPhotoItemDataMutation: procedure
      .input(z.object({ photoPath: z.string(), width: z.number().optional() }))
      .mutation(async (ctx) => {
        return runEffect(
          vrchatPhotoService
            .getVRChatPhotoItemData(ctx.input)
            .pipe(Effect.mapError(mapPhotoNotFoundError)),
        );
      }),
    getVRChatPhotoItemData: procedure.input(z.string()).query(async (ctx) => {
      const exit = await Effect.runPromiseExit(
        vrchatPhotoService.getVRChatPhotoItemData({
          photoPath: ctx.input,
          width: 256,
        }),
      );
      if (Exit.isFailure(exit)) {
        const failOpt = Cause.failureOption(exit.cause);
        if (Option.isSome(failOpt)) {
          return {
            data: null,
            error: failOpt.value,
          };
        }
        // Defect: re-throw
        const dieOpt = Cause.dieOption(exit.cause);
        if (Option.isSome(dieOpt)) {
          throw dieOpt.value;
        }
        return {
          data: null,
          error: 'unknown_error',
        };
      }
      return {
        data: exit.value,
        error: null,
      };
    }),
    validateVRChatPhotoPath: procedure
      .input(z.string())
      .mutation(async (ctx) => {
        const result = await vrchatPhotoService.validateVRChatPhotoPathModel({
          fullpath: ctx.input,
        });
        logger.debug('validateVRChatPhotoPath', ctx.input, result);
        return {
          result,
        };
      }),
    /**
     * 軽量メタデータのみ取得（初回クエリ用）
     * photoPath を含まないことでメモリ使用量を大幅に削減
     */
    getVrchatPhotoMetadataList: procedure
      .input(
        z
          .object({
            gtPhotoTakenAt: z.date().optional(),
            ltPhotoTakenAt: z.date().optional(),
            orderByPhotoTakenAt: z.enum(['asc', 'desc']),
          })
          .optional(),
      )
      .query(async (ctx) => {
        const result = await vrchatPhotoService.getVRChatPhotoMetadataList(
          ctx.input,
        );
        return result;
      }),
    /**
     * 指定されたIDの写真パスをオンデマンドでバッチ取得
     * 表示に必要な範囲のみ取得
     */
    getVrchatPhotoPathsByIds: procedure
      .input(
        z.object({
          ids: z.array(z.string()).max(500), // バッチサイズ制限
        }),
      )
      .query(async (ctx) => {
        const pathMap = await vrchatPhotoService.getVRChatPhotoPathsByIds(
          ctx.input.ids,
        );
        // Map を配列に変換（tRPC での転送用）
        return [...pathMap.entries()].map(([id, photoPath]) => ({
          id,
          photoPath,
        }));
      }),
    /**
     * 複数のサムネイルをバッチ取得（Google Photos風の高速ローディング）
     * 個別リクエストより効率的にサムネイルを取得
     *
     * @returns 成功したサムネイルと失敗情報を含む構造化された結果
     */
    getBatchThumbnails: procedure
      .input(
        z.object({
          photoPaths: z.array(z.string()).max(50), // バッチサイズ制限
          width: z.number().int().positive().max(512).optional(),
        }),
      )
      .query(async (ctx) => {
        const result = await vrchatPhotoService.getBatchThumbnails(
          ctx.input.photoPaths,
          ctx.input.width,
        );
        // Map を配列に変換（tRPC での転送用）
        return {
          success: [...result.success.entries()].map(([photoPath, data]) => ({
            photoPath,
            data,
          })),
          failed: result.failed,
        };
      }),
  });
