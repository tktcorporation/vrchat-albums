/**
 * VRChat 写真メタデータの Zod スキーマ定義
 *
 * VRChat公式 (2025.3.1以降) が XMP 形式で写真に埋め込むメタデータをパースする。
 *
 * XMP フィールド:
 * - Author: 撮影者の表示名
 * - vrc:AuthorID: 撮影者のユーザーID
 * - vrc:WorldDisplayName: ワールド表示名
 * - vrc:WorldID: ワールドID
 *
 * プライベートワールドではワールド情報が含まれない。
 * カメラUIのトグルでメタデータ書き込み自体が無効化されている場合もある。
 *
 * @see https://docs.vrchat.com/docs/vrchat-202531 - VRChat 2025.3.1 リリースノート
 * @see https://docs.vrchat.com/docs/vrchat-202532 - メタデータトグル追加
 */

import { z } from 'zod';

/**
 * VRChat公式が XMP に埋め込むメタデータ (2025.3.1以降)
 */
export const VRChatPhotoMetadataSchema = z.object({
  /** 撮影者のVRChat表示名 (標準XMP Author フィールド) */
  authorDisplayName: z.string().min(1),
  /** 撮影者のVRChatユーザーID (vrc:AuthorID) */
  authorId: z.string().min(1),
  /** ワールドの表示名 (vrc:WorldDisplayName) — プライベートワールドでは null */
  worldDisplayName: z.string().min(1).nullable(),
  /** ワールドID (vrc:WorldID) — プライベートワールドでは null */
  worldId: z.string().min(1).nullable(),
});

export type VRChatPhotoMetadata = z.infer<typeof VRChatPhotoMetadataSchema>;
