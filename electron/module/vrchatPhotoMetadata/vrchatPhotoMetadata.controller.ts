/**
 * VRChat 写真メタデータの tRPC コントローラー
 *
 * フロントエンドから VRChat公式XMPメタデータを取得するための API を提供する。
 */

import z from 'zod';
import { logger } from '../../lib/logger';
import { procedure, router as trpcRouter } from '../../trpc';
import * as metadataService from './service';

export const vrchatPhotoMetadataRouter = () =>
  trpcRouter({
    /**
     * 単一写真のメタデータを取得
     */
    getPhotoMetadata: procedure
      .input(z.object({ photoPath: z.string().min(1) }))
      .query(async (ctx) => {
        const result = await metadataService.getMetadataForPhoto(
          ctx.input.photoPath,
        );
        if (result.isErr()) {
          logger.error({
            message: `Failed to get photo metadata: ${result.error.message}`,
          });
          return null;
        }
        return result.value;
      }),

    /**
     * 複数写真のメタデータをバッチ取得
     */
    getPhotoMetadataBatch: procedure
      .input(
        z.object({
          photoPaths: z.array(z.string()).max(100),
        }),
      )
      .query(async (ctx) => {
        const result = await metadataService.getMetadataForPhotos(
          ctx.input.photoPaths,
        );
        if (result.isErr()) {
          logger.error({
            message: `Failed to get photo metadata batch: ${result.error.message}`,
          });
          return [];
        }
        // Map → 配列に変換 (tRPC転送用)
        return Array.from(result.value.entries()).map(
          ([photoPath, metadata]) => ({
            photoPath,
            ...metadata,
          }),
        );
      }),

    /**
     * ワールドIDから写真メタデータを検索
     */
    getPhotosByWorldId: procedure
      .input(z.object({ worldId: z.string().min(1) }))
      .query(async (ctx) => {
        const result = await metadataService.getPhotosByWorldId(
          ctx.input.worldId,
        );
        if (result.isErr()) {
          logger.error({
            message: `Failed to get photos by world ID: ${result.error.message}`,
          });
          return [];
        }
        return result.value;
      }),

    /**
     * 指定写真のメタデータをオンデマンドで抽出 (ファイルから直接読み取り)
     *
     * DBにメタデータが存在しない場合に、写真ファイルから直接パースする。
     * 結果はDBに保存されない (表示用)。
     */
    extractPhotoMetadata: procedure
      .input(z.object({ photoPath: z.string().min(1) }))
      .mutation(async (ctx) => {
        const result = await metadataService.extractMetadataFromPhoto(
          ctx.input.photoPath,
        );
        if (result.isErr()) {
          logger.debug(`Metadata extraction failed: ${result.error.message}`);
          return null;
        }
        return result.value;
      }),
  });
