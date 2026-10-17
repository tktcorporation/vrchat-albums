/**
 * VRChat 写真メタデータパーサー
 *
 * VRChat公式 (2025.3.1以降) が XMP 形式で写真に埋め込むメタデータを、
 * @vrchat-albums/exif-native が読み取った JsVrcXmpMetadata から型安全にパースする。
 *
 * XMP フィールドと JsVrcXmpMetadata の対応:
 * - vrc:AuthorID → authorId: 撮影者ユーザーID
 * - Author → author: 撮影者表示名
 * - vrc:WorldID → worldId: ワールドID
 * - vrc:WorldDisplayName → worldDisplayName: ワールド表示名
 *
 * @see electron/module/vrchatPhotoMetadata/schema.ts - メタデータの Zod スキーマ定義
 */

import type { JsVrcXmpMetadata } from '@vrchat-albums/exif-native';

import { type VRChatPhotoMetadata, VRChatPhotoMetadataSchema } from './schema';

/**
 * 欠けたフィールド（undefined）と空文字を null に揃える。
 *
 * スキーマは空文字を拒否するため、空のワールド情報で写真全体を捨てないよう先に null へ寄せる。
 */
const nonEmptyOrNull = (value: string | undefined): string | null =>
  value === undefined || value.length === 0 ? null : value;

/**
 * exif-native の XMP 読み取り結果から VRChat 公式メタデータを抽出する
 *
 * authorId が無ければ VRChat メタデータなしと判断して null を返す。
 * Zod スキーマで最終検証する（Parse Don't Validate）。
 */
export const extractOfficialMetadata = (
  xmp: JsVrcXmpMetadata,
): VRChatPhotoMetadata | null => {
  const authorId = nonEmptyOrNull(xmp.authorId);
  if (authorId === null) {
    return null;
  }

  const parsed = VRChatPhotoMetadataSchema.safeParse({
    authorId,
    // 表示名が埋め込まれていない写真では ID を表示名として扱う
    authorDisplayName: nonEmptyOrNull(xmp.author) ?? authorId,
    // プライベートワールド等ではワールド情報が欠ける
    worldId: nonEmptyOrNull(xmp.worldId),
    worldDisplayName: nonEmptyOrNull(xmp.worldDisplayName),
  });

  if (!parsed.success) {
    return null;
  }

  return parsed.data;
};
