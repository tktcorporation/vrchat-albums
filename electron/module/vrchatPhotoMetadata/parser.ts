/**
 * VRChat 写真メタデータパーサー
 *
 * VRChat公式 (2025.3.1以降) が XMP 形式で写真に埋め込むメタデータを
 * exiftool-vendored で読み取り、型安全にパースする。
 *
 * @see electron/module/vrchatPhotoMetadata/schema.ts - メタデータの Zod スキーマ定義
 */

import { err, ok, type Result } from 'neverthrow';
import type { VRChatPhotoMetadata } from './schema';

// ============================================================================
// エラー型
// ============================================================================

export type MetadataParseError =
  | { type: 'NO_METADATA_FOUND'; message: string }
  | { type: 'PARSE_ERROR'; message: string };

// ============================================================================
// VRChat公式メタデータ (XMP) パーサー
// ============================================================================

/**
 * exiftool の Tags オブジェクトから VRChat 公式メタデータを抽出する
 *
 * exiftool-vendored は XMP カスタムネームスペース (vrc:) のフィールドも
 * 読み取り可能。フィールドが存在しない場合は null を返す。
 *
 * VRChat 2025.3.1 で導入されたフィールド:
 * - AuthorID (vrc:AuthorID): 撮影者ユーザーID
 * - Author: 撮影者表示名
 * - WorldID (vrc:WorldID): ワールドID
 * - WorldDisplayName (vrc:WorldDisplayName): ワールド表示名
 */
export const extractOfficialMetadata = (
  // biome-ignore lint/suspicious/noExplicitAny: exiftool Tags の型は広すぎるため any で受ける
  tags: Record<string, any>,
): VRChatPhotoMetadata | null => {
  // vrc:AuthorID が存在しない場合はメタデータなしと判断
  const authorId = tags.AuthorID ?? tags['vrc:AuthorID'] ?? null;
  if (!authorId || typeof authorId !== 'string') {
    return null;
  }

  const authorDisplayName =
    tags.Author ??
    tags.Creator ??
    tags['xmp:Creator'] ??
    tags['dc:creator'] ??
    null;

  const worldId =
    tags.WorldID ?? tags['vrc:WorldID'] ?? tags.VRCWorldID ?? null;

  const worldDisplayName =
    tags.WorldDisplayName ??
    tags['vrc:WorldDisplayName'] ??
    tags.VRCWorldDisplayName ??
    null;

  return {
    authorId: typeof authorId === 'string' ? authorId : String(authorId),
    authorDisplayName:
      typeof authorDisplayName === 'string'
        ? authorDisplayName
        : authorDisplayName
          ? String(authorDisplayName)
          : authorId,
    worldId: typeof worldId === 'string' && worldId.length > 0 ? worldId : null,
    worldDisplayName:
      typeof worldDisplayName === 'string' && worldDisplayName.length > 0
        ? worldDisplayName
        : null,
  };
};

/**
 * VRChat 写真ファイルから公式XMPメタデータを読み取る
 *
 * exiftool のインスタンスは外部から注入する設計。
 * これにより、複数ファイルの処理時にインスタンスを再利用でき、
 * テスト時にモック可能。
 */
export const parsePhotoMetadata = async (
  filePath: string,
  // biome-ignore lint/suspicious/noExplicitAny: exiftool Tags の型は広すぎるため any で受ける
  readExifTags: (filePath: string) => Promise<Record<string, any>>,
): Promise<Result<VRChatPhotoMetadata, MetadataParseError>> => {
  let tags: Record<string, unknown>;
  try {
    tags = await readExifTags(filePath);
  } catch (e) {
    return err({
      type: 'PARSE_ERROR',
      message: `Failed to read EXIF/XMP from ${filePath}: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  const metadata = extractOfficialMetadata(tags);
  if (metadata === null) {
    return err({
      type: 'NO_METADATA_FOUND',
      message: 'No VRChat XMP metadata found in photo',
    });
  }

  return ok(metadata);
};

/**
 * 複数の写真からメタデータをバッチ抽出する
 *
 * メモリ使用量を抑えるため、並列数を制限して処理する。
 * 個別のファイルでエラーが発生しても、他のファイルの処理は継続する。
 */
export const parsePhotoMetadataBatch = async (
  filePaths: string[],
  // biome-ignore lint/suspicious/noExplicitAny: exiftool Tags の型は広すぎるため any で受ける
  readExifTags: (filePath: string) => Promise<Record<string, any>>,
  concurrency = 5,
): Promise<Map<string, VRChatPhotoMetadata>> => {
  const results = new Map<string, VRChatPhotoMetadata>();

  // 並列数制限付きで処理
  for (let i = 0; i < filePaths.length; i += concurrency) {
    const batch = filePaths.slice(i, i + concurrency);
    const promises = batch.map(async (filePath) => {
      const result = await parsePhotoMetadata(filePath, readExifTags);
      if (result.isOk()) {
        results.set(filePath, result.value);
      }
    });
    await Promise.all(promises);
  }

  return results;
};
