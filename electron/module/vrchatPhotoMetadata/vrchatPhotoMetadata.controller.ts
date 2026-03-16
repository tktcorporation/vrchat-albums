/**
 * VRChat 写真メタデータの tRPC コントローラー
 *
 * フロントエンドから VRChat公式XMPメタデータを取得するための API を提供する。
 *
 * エラーハンドリング方針:
 * - DB_ERROR: 予期しないエラー → handleResultError で UserFacingError を throw（Sentry送信）
 * - NO_METADATA_FOUND / PARSE_ERROR: 予期されたエラー → silentErrors で null を返す
 */

import z from 'zod';
import { handleResultError } from '../../lib/errorHelpers';
import {
  ERROR_CATEGORIES,
  ERROR_CODES,
  UserFacingError,
} from '../../lib/errors';
import { procedure, router as trpcRouter } from '../../trpc';
import * as metadataService from './service';

/**
 * メタデータサービスのエラーマッピング
 *
 * DB_ERROR は予期しないエラーなので UserFacingError を生成する。
 * NO_METADATA_FOUND / PARSE_ERROR は silentErrors で処理する。
 */
const metadataErrorMappings = {
  DB_ERROR: () =>
    UserFacingError.withStructuredInfo({
      code: ERROR_CODES.UNKNOWN,
      category: ERROR_CATEGORIES.UNKNOWN_ERROR,
      message: 'Database error while accessing photo metadata',
      userMessage: '写真メタデータの取得中にエラーが発生しました。',
    }),
} as const;

/** 予期されたエラー: メタデータが存在しない、パースに失敗した場合は null を返す */
const SILENT_METADATA_ERRORS = ['NO_METADATA_FOUND', 'PARSE_ERROR'];

export const vrchatPhotoMetadataRouter = () =>
  trpcRouter({
    /**
     * 単一写真のメタデータを取得
     *
     * DB_ERROR → UserFacingError を throw
     */
    getPhotoMetadata: procedure
      .input(z.object({ photoPath: z.string().min(1) }))
      .query(async (ctx) => {
        const result = await metadataService.getMetadataForPhoto(
          ctx.input.photoPath,
        );
        return handleResultError(result, metadataErrorMappings);
      }),

    /**
     * 複数写真のメタデータをバッチ取得
     *
     * DB_ERROR → UserFacingError を throw
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
        const metadataMap = handleResultError(result, metadataErrorMappings);
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
     * DB_ERROR → UserFacingError を throw
     */
    getPhotosByWorldId: procedure
      .input(z.object({ worldId: z.string().min(1) }))
      .query(async (ctx) => {
        const result = await metadataService.getPhotosByWorldId(
          ctx.input.worldId,
        );
        return handleResultError(result, metadataErrorMappings);
      }),

    /**
     * 指定写真のメタデータをオンデマンドで抽出 (ファイルから直接読み取り)
     *
     * DBにメタデータが存在しない場合に、写真ファイルから直接パースする。
     * 結果はDBに保存されない (表示用)。
     *
     * NO_METADATA_FOUND / PARSE_ERROR → null を返す（メタデータなしは正常系）
     */
    extractPhotoMetadata: procedure
      .input(z.object({ photoPath: z.string().min(1) }))
      .mutation(async (ctx) => {
        const result = await metadataService.extractMetadataFromPhoto(
          ctx.input.photoPath,
        );
        return handleResultError(result, metadataErrorMappings, {
          silentErrors: SILENT_METADATA_ERRORS,
        });
      }),
  });
