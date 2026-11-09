/**
 * VRChat 写真メタデータの DB 操作
 *
 * VRChat公式 (2025.3.1以降) が XMP で写真に埋め込むメタデータを永続化する。
 * VRChatPhotoPathModel と photoPath で 1:1 の関係。
 *
 * @see electron/module/vrchatPhotoMetadata/schema.ts - メタデータの Zod スキーマ定義
 * @see electron/module/vrchatPhotoMetadata/parser.ts - メタデータの抽出・パース処理
 */

import { inArray, sql } from 'drizzle-orm';

import { getDB } from '../../lib/db/client';
import { vrchatPhotoMetadata } from '../../lib/db/schema';

export type VRChatPhotoMetadataModel = typeof vrchatPhotoMetadata.$inferSelect;

export interface VRChatPhotoMetadataCreationAttributes {
  photoPath: string;
  authorId: string;
  authorDisplayName: string;
  worldId: string | null;
  worldDisplayName: string | null;
}

/**
 * メタデータレコードを一括で登録・更新する
 *
 * 同じ photoPath のレコードが既に存在する場合は、メタデータの列と updatedAt を更新する。
 * 写真インデックス作成時にバッチで呼び出される。
 */
export const createOrUpdatePhotoMetadataBatch = async (
  attributes: VRChatPhotoMetadataCreationAttributes[],
): Promise<VRChatPhotoMetadataModel[]> => {
  if (attributes.length === 0) {
    return [];
  }

  return getDB()
    .insert(vrchatPhotoMetadata)
    .values(attributes)
    .onConflictDoUpdate({
      target: vrchatPhotoMetadata.photoPath,
      set: {
        authorId: sql`excluded.${sql.identifier('authorId')}`,
        authorDisplayName: sql`excluded.${sql.identifier('authorDisplayName')}`,
        worldId: sql`excluded.${sql.identifier('worldId')}`,
        worldDisplayName: sql`excluded.${sql.identifier('worldDisplayName')}`,
        updatedAt: sql`excluded.${sql.identifier('updatedAt')}`,
      },
    })
    .returning()
    .all();
};

/**
 * 入力パスのうち、まだメタデータが存在しないパスだけを返す
 *
 * SQL の IN でフィルタするため、全件をメモリにロードしない。
 * SQLite のパラメータ上限を避けるためチャンク分割する。
 *
 * 呼び出し元: service.extractAndSaveMetadataBatch（差分処理）
 */
const CHUNK_SIZE = 500;
export const filterPathsWithoutMetadata = async (
  photoPaths: string[],
): Promise<string[]> => {
  if (photoPaths.length === 0) {
    return [];
  }

  // DB に存在するパスをチャンクごとに照合
  const existingPaths = new Set<string>();
  for (let i = 0; i < photoPaths.length; i += CHUNK_SIZE) {
    const chunk = photoPaths.slice(i, i + CHUNK_SIZE);
    const records = getDB()
      .select({ photoPath: vrchatPhotoMetadata.photoPath })
      .from(vrchatPhotoMetadata)
      .where(inArray(vrchatPhotoMetadata.photoPath, chunk))
      .all();
    for (const r of records) {
      existingPaths.add(r.photoPath);
    }
  }

  return photoPaths.filter((p) => !existingPaths.has(p));
};
