import { and, asc, count, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';

import { getDB } from '../../../lib/db/client';
import { vrchatPhotoPaths } from '../../../lib/db/schema';

/**
 * VRChat 写真のパス・撮影日時・大きさの行。
 *
 * @see docs/photo-grouping-logic.md - 写真グループ化ロジック
 * @see VRChatWorldJoinLogModel - ワールド参加ログとの関連
 */
export type VRChatPhotoPathModel = typeof vrchatPhotoPaths.$inferSelect;

/** 撮影日時の範囲の条件。境界はどちらも含まない */
const photoTakenAtBetween = (query?: {
  gtPhotoTakenAt?: Date;
  ltPhotoTakenAt?: Date;
}) =>
  and(
    query?.gtPhotoTakenAt
      ? gt(vrchatPhotoPaths.photoTakenAt, query.gtPhotoTakenAt)
      : undefined,
    query?.ltPhotoTakenAt
      ? lt(vrchatPhotoPaths.photoTakenAt, query.ltPhotoTakenAt)
      : undefined,
  );

const photoTakenAtOrder = (order: 'asc' | 'desc' | undefined) =>
  order === 'desc'
    ? desc(vrchatPhotoPaths.photoTakenAt)
    : asc(vrchatPhotoPaths.photoTakenAt);

interface VRChatPhotoPathCreationAttributes {
  photoPath: string;
  photoTakenAt: Date;
  width: number;
  height: number;
}

/**
 * 写真パス一覧を一括で登録・更新する
 * createVRChatPhotoPathIndex から呼び出される
 */
export const createOrUpdateListVRChatPhotoPath = async (
  attributes: VRChatPhotoPathCreationAttributes[],
): Promise<VRChatPhotoPathModel[]> => {
  if (attributes.length === 0) {
    return [];
  }
  // 同じ photoPath の行があれば撮影日時と updatedAt だけを更新する。大きさは初回の登録の値を残す
  return getDB()
    .insert(vrchatPhotoPaths)
    .values(
      attributes.map((attribute) => ({
        photoPath: attribute.photoPath,
        photoTakenAt: attribute.photoTakenAt,
        width: attribute.width,
        height: attribute.height,
      })),
    )
    .onConflictDoUpdate({
      target: vrchatPhotoPaths.photoPath,
      set: {
        photoTakenAt: sql`excluded.${sql.identifier('photoTakenAt')}`,
        updatedAt: sql`excluded.${sql.identifier('updatedAt')}`,
      },
    })
    .returning()
    .all();
};

/**
 * VRChatの写真の保存pathを取得する
 * ページネーション対応（オプション）
 *
 * 注意: バーチャルスクロールで高さ計算を行っているため、
 * フロントエンドでページネーションを実装するまでは
 * limit/offset を指定せずに全件取得することを推奨
 *
 * @param query.limit 取得する最大件数（指定しない場合は全件取得）
 * @param query.offset スキップする件数（デフォルト: 0）
 */
export const getVRChatPhotoPathList = async (query?: {
  gtPhotoTakenAt?: Date;
  ltPhotoTakenAt?: Date;
  orderByPhotoTakenAt: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}): Promise<VRChatPhotoPathModel[]> => {
  const select = getDB()
    .select()
    .from(vrchatPhotoPaths)
    .where(photoTakenAtBetween(query))
    .orderBy(photoTakenAtOrder(query?.orderByPhotoTakenAt))
    .$dynamic();
  // limit が明示的に指定された場合のみ適用（デフォルトは全件取得）
  const limited =
    query?.limit === undefined ? select : select.limit(query.limit);
  const paged =
    query?.offset === undefined
      ? limited
      : // SQLite は LIMIT の無い OFFSET を受け付けないため、limit が無ければ上限なし（-1）を付ける
        (query.limit === undefined ? limited.limit(-1) : limited).offset(
          query.offset,
        );
  return paged.all();
};

/**
 * photoPath の完全一致でレコードを取得する
 */
export const getVRChatPhotoPathByPhotoPath = async (
  photoPath: string,
): Promise<VRChatPhotoPathModel | null> => {
  return (
    getDB()
      .select()
      .from(vrchatPhotoPaths)
      .where(eq(vrchatPhotoPaths.photoPath, photoPath))
      .get() ?? null
  );
};

/**
 * 行を削除する
 * validateVRChatPhotoPathModel から利用される
 */
export const deleteVRChatPhotoPathModel = async (
  photoPathModel: VRChatPhotoPathModel,
): Promise<void> => {
  getDB()
    .delete(vrchatPhotoPaths)
    .where(eq(vrchatPhotoPaths.id, photoPathModel.id))
    .run();
};

const PhotoCountPerMonthRowSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  count: z.coerce.number().int().min(1),
});

/**
 * 撮影月（ローカルタイム基準の `YYYY-MM`）ごとの写真枚数を、月の昇順で返す。
 *
 * photoTakenAt は UTC で保存されるため、SQLite の `localtime` 修飾子でローカルタイムに戻してから
 * 月を切り出す。これをしないと月末深夜の写真が UTC 側の月に数えられる。
 * 起動画面の月別グラフ（initProgress/stats.ts）から呼び出される。
 */
export const getPhotoCountPerLocalMonth = async (): Promise<
  { month: string; count: number }[]
> => {
  const month = sql<string>`strftime('%Y-%m', ${vrchatPhotoPaths.photoTakenAt}, 'localtime')`;
  const rows = getDB()
    .select({ month, count: count(vrchatPhotoPaths.id) })
    .from(vrchatPhotoPaths)
    .groupBy(month)
    .orderBy(asc(month))
    .all();
  return z.array(PhotoCountPerMonthRowSchema).parse(rows);
};

/**
 * 軽量メタデータ型（ハイブリッドローディング用）
 */
export interface VRChatPhotoMetadata {
  id: string;
  photoTakenAt: Date;
  width: number;
  height: number;
}

/**
 * 軽量メタデータのみ取得する（初回クエリ用）
 * photoPath を含まないことでメモリ使用量を削減
 *
 * @see docs/photo-grouping-logic.md - 写真グループ化ロジック
 * @see VRChatPhotoMetadata - 戻り値の型定義
 */
export const getVRChatPhotoMetadataList = async (query?: {
  gtPhotoTakenAt?: Date;
  ltPhotoTakenAt?: Date;
  orderByPhotoTakenAt: 'asc' | 'desc';
}): Promise<VRChatPhotoMetadata[]> => {
  return getDB()
    .select({
      id: vrchatPhotoPaths.id,
      photoTakenAt: vrchatPhotoPaths.photoTakenAt,
      width: vrchatPhotoPaths.width,
      height: vrchatPhotoPaths.height,
    })
    .from(vrchatPhotoPaths)
    .where(photoTakenAtBetween(query))
    .orderBy(photoTakenAtOrder(query?.orderByPhotoTakenAt))
    .all();
};

/**
 * 指定されたIDの写真パスをオンデマンドでバッチ取得
 * 表示に必要な範囲のみ取得することでメモリ使用量を削減
 */
export const getVRChatPhotoPathsByIds = async (
  ids: string[],
): Promise<Map<string, string>> => {
  if (ids.length === 0) {
    return new Map();
  }

  const photos = getDB()
    .select({ id: vrchatPhotoPaths.id, photoPath: vrchatPhotoPaths.photoPath })
    .from(vrchatPhotoPaths)
    .where(inArray(vrchatPhotoPaths.id, ids))
    .all();

  const pathMap = new Map<string, string>();
  for (const photo of photos) {
    pathMap.set(photo.id, photo.photoPath);
  }

  return pathMap;
};
