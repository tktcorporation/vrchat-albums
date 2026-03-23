/**
 * VRChat 写真メタデータの tRPC コントローラー
 *
 * フロントエンドから VRChat公式XMPメタデータを取得するための API を提供する。
 *
 * エラーハンドリング方針:
 * - MetadataDbError: 予期しないエラー → runEffect で UserFacingError に変換（Sentry送信）
 * - NoMetadataFound / MetadataParseError: 予期されたエラー → catchTag で null に変換
 */

import { Effect } from 'effect';
import z from 'zod';

import { runEffect } from '../../lib/effectTRPC';
import {
  ERROR_CATEGORIES,
  ERROR_CODES,
  UserFacingError,
} from '../../lib/errors';
import { procedure, router as trpcRouter } from '../../trpc';
import * as metadataService from './service';

/**
 * MetadataDbError → UserFacingError に変換するヘルパー
 * cause を含めて Sentry が元エラーを追跡可能にする
 */
const mapDbErrorToUserFacing = (e: { message: string }) =>
  UserFacingError.withStructuredInfo({
    code: ERROR_CODES.DATABASE_ERROR,
    category: ERROR_CATEGORIES.DATABASE_ERROR,
    message: e.message,
    userMessage: '写真メタデータの取得中にエラーが発生しました。',
    cause: e instanceof Error ? e : new Error(e.message),
  });

export const vrchatPhotoMetadataRouter = () =>
  trpcRouter({
    /**
     * 単一写真のメタデータを取得
     *
     * MetadataDbError → UserFacingError (Sentry送信)
     */
    getPhotoMetadata: procedure
      .input(z.object({ photoPath: z.string().min(1) }))
      .query(({ input }) =>
        runEffect(
          metadataService
            .getMetadataForPhoto(input.photoPath)
            .pipe(Effect.mapError(mapDbErrorToUserFacing)),
        ),
      ),

    /**
     * 複数写真のメタデータをバッチ取得
     *
     * MetadataDbError → UserFacingError (Sentry送信)
     */
    getPhotoMetadataBatch: procedure
      .input(
        z.object({
          photoPaths: z.array(z.string()).max(100),
        }),
      )
      .query(async ({ input }) => {
        const metadataMap = await runEffect(
          metadataService
            .getMetadataForPhotos(input.photoPaths)
            .pipe(Effect.mapError(mapDbErrorToUserFacing)),
        );
        if (!metadataMap) {
          return [];
        }
        // Map → 配列に変換 (tRPC転送用)
        return Array.from(metadataMap.entries()).map(
          ([photoPath, metadata]) => ({
            photoPath,
            ...metadata,
          }),
        );
      }),

    /**
     * ワールドIDから写真メタデータを検索
     *
     * MetadataDbError → UserFacingError (Sentry送信)
     */
    getPhotosByWorldId: procedure
      .input(z.object({ worldId: z.string().min(1) }))
      .query(({ input }) =>
        runEffect(
          metadataService
            .getPhotosByWorldId(input.worldId)
            .pipe(Effect.mapError(mapDbErrorToUserFacing)),
        ),
      ),

    /**
     * 指定写真のメタデータをオンデマンドで抽出 (ファイルから直接読み取り)
     *
     * DBにメタデータが存在しない場合に、写真ファイルから直接パースする。
     * 結果はDBに保存されない (表示用)。
     *
     * NoMetadataFound / MetadataParseError → null（メタデータなしは正常系）
     */
    extractPhotoMetadata: procedure
      .input(z.object({ photoPath: z.string().min(1) }))
      .mutation(({ input }) =>
        runEffect(
          metadataService.extractMetadataFromPhoto(input.photoPath).pipe(
            // 予期されたエラー → null に変換（silent、Sentry にも送らない）
            Effect.catchTag('NoMetadataFound', () => Effect.succeed(null)),
            Effect.catchTag('MetadataParseError', () => Effect.succeed(null)),
          ),
        ),
      ),
  });
