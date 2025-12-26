import * as neverthrow from 'neverthrow';
import z from 'zod';
import {
  handlePhotoOperationError,
  handleResultError,
  photoOperationErrorMappings,
} from '../../lib/errorHelpers';
import { logger } from './../../lib/logger';
import { eventEmitter, procedure, router as trpcRouter } from './../../trpc';
import * as utilsService from './../electronUtil/service';
import * as vrchatPhotoService from './../vrchatPhoto/vrchatPhoto.service';
import { VRChatPhotoDirPathSchema } from './valueObjects';

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
}): Promise<
  neverthrow.Result<
    {
      id: string;
      photoPath: string;
      photoTakenAt: Date;
      width: number;
      height: number;
    }[],
    Error
  >
> => {
  const vrchatPhotoPathList =
    await vrchatPhotoService.getVRChatPhotoPathList(query);
  return neverthrow.ok(
    vrchatPhotoPathList.map((photoPathModel) => ({
      id: photoPathModel.id,
      photoPath: photoPathModel.photoPath,
      width: photoPathModel.width,
      height: photoPathModel.height,
      photoTakenAt: photoPathModel.photoTakenAt,
    })),
  );
};

const getCountByYearMonthList = async (): Promise<
  neverthrow.Result<
    {
      photoTakenYear: number;
      photoTakenMonth: number;
      photoCount: number;
    }[],
    never
  >
> => {
  const countByYearMonthList =
    await vrchatPhotoService.getCountByYearMonthList();
  return neverthrow.ok(countByYearMonthList);
};

const setVRChatPhotoDirPathByDialog = async (): Promise<
  neverthrow.Result<void, 'canceled'>
> => {
  return (await utilsService.openGetDirDialog()).map((dirPath) => {
    vrchatPhotoService.setVRChatPhotoDirPathToSettingStore(
      VRChatPhotoDirPathSchema.parse(dirPath),
    );
    return undefined;
  });
};

export const vrchatPhotoRouter = () =>
  trpcRouter({
    getVRChatPhotoDirPath: procedure.query(async () => {
      const result = await vrchatPhotoService.getVRChatPhotoDirPath();
      return result;
    }),
    setVRChatPhotoDirPathToSettingStore: procedure.mutation(async () => {
      const result = await setVRChatPhotoDirPathByDialog();
      return result.match(
        () => {
          eventEmitter.emit('toast', 'VRChatの写真の保存先を設定しました');
          return true;
        },
        (error) => {
          eventEmitter.emit('toast', error);
          return false;
        },
      );
    }),
    clearVRChatPhotoDirPathInSettingStore: procedure.mutation(async () => {
      const result =
        await vrchatPhotoService.clearVRChatPhotoDirPathInSettingStore();
      return result;
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
        const result = await getVRChatLogFilePathModelList(ctx.input);
        return handleResultError(result, {
          default: (error) => photoOperationErrorMappings.default(error),
        });
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
      const result = await getCountByYearMonthList();
      return handleResultError(result, {
        default: (error) => photoOperationErrorMappings.default(error),
      });
    }),
    getVRChatPhotoItemDataMutation: procedure
      .input(z.object({ photoPath: z.string(), width: z.number().optional() }))
      .mutation(async (ctx) => {
        const result = await vrchatPhotoService.getVRChatPhotoItemData(
          ctx.input,
        );
        return handlePhotoOperationError(result);
      }),
    getVRChatPhotoItemData: procedure.input(z.string()).query(async (ctx) => {
      const result = await vrchatPhotoService.getVRChatPhotoItemData({
        photoPath: ctx.input,
        width: 256,
      });
      if (result.isErr()) {
        return {
          data: null,
          error: result.error,
        };
      }
      return {
        data: result.value,
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
     * 軽量メタデータのみ取得（ハイブリッドローディング Phase 1）
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
     * 指定されたIDの写真パスをバッチ取得（ハイブリッドローディング Phase 2）
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
        return Array.from(pathMap.entries()).map(([id, photoPath]) => ({
          id,
          photoPath,
        }));
      }),
    /**
     * 複数のサムネイルをバッチ取得（Google Photos風の高速ローディング）
     * 個別リクエストより効率的にサムネイルを取得
     */
    getBatchThumbnails: procedure
      .input(
        z.object({
          photoPaths: z.array(z.string()).max(50), // バッチサイズ制限
          width: z.number().int().positive().max(512).optional(),
        }),
      )
      .query(async (ctx) => {
        const thumbnailMap = await vrchatPhotoService.getBatchThumbnails(
          ctx.input.photoPaths,
          ctx.input.width,
        );
        // Map を配列に変換（tRPC での転送用）
        return Array.from(thumbnailMap.entries()).map(([photoPath, data]) => ({
          photoPath,
          data,
        }));
      }),
  });
