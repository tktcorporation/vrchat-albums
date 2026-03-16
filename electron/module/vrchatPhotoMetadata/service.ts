/**
 * VRChat 写真メタデータサービス
 *
 * VRChat公式XMPメタデータの抽出・保存・取得を管理するサービス層。
 * パーサーとDBモデルの間を仲介する。
 *
 * 呼び出し元: 写真インデックス作成時、tRPC コントローラー
 */

import { err, ok, type Result } from 'neverthrow';
import { logger } from '../../lib/logger';
import {
  type MetadataParseError,
  parsePhotoMetadata,
  parsePhotoMetadataBatch,
} from './parser';
import type { VRChatPhotoMetadata } from './schema';
import {
  createOrUpdatePhotoMetadataBatch,
  getPhotoMetadataByPhotoPath,
  getPhotoMetadataByPhotoPaths,
  getPhotoMetadataByWorldId,
  getPhotoPathsWithMetadata,
  type VRChatPhotoMetadataCreationAttributes,
} from './vrchatPhotoMetadata.model';

// ============================================================================
// エラー型
// ============================================================================

export type MetadataServiceError =
  | MetadataParseError
  | { type: 'DB_ERROR'; message: string };

// ============================================================================
// Exiftool アダプター
// ============================================================================

// biome-ignore lint/suspicious/noExplicitAny: exiftool Tags は広い型
type ExifTagReader = (filePath: string) => Promise<Record<string, any>>;

const createExifTagReader = (): ExifTagReader => {
  // exiftool インスタンスを遅延初期化で保持
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let exiftoolInstance: any = null;

  return async (filePath: string) => {
    if (!exiftoolInstance) {
      const { ExifTool } = await import('exiftool-vendored');
      exiftoolInstance = new ExifTool();
    }
    const tags = await exiftoolInstance.read(filePath);
    return tags as Record<string, unknown>;
  };
};

// シングルトンのexifタグリーダー
let exifTagReader: ExifTagReader | null = null;

const getExifTagReader = () => {
  if (!exifTagReader) {
    exifTagReader = createExifTagReader();
  }
  return exifTagReader;
};

// ============================================================================
// サービス関数
// ============================================================================

/**
 * 単一の写真からメタデータを抽出する
 */
export const extractMetadataFromPhoto = async (
  photoPath: string,
): Promise<Result<VRChatPhotoMetadata, MetadataParseError>> => {
  return parsePhotoMetadata(photoPath, getExifTagReader());
};

/**
 * 複数の写真からメタデータを抽出してDBに保存する
 *
 * 差分処理: 既にメタデータ抽出済みの写真はスキップする。
 * 写真インデックス作成時（loadLogInfoIndexFromVRChatLog）から呼び出される。
 *
 * @returns 新たに抽出・保存したメタデータの件数
 */
export const extractAndSaveMetadataBatch = async (
  photoPaths: string[],
  concurrency = 5,
): Promise<Result<number, MetadataServiceError>> => {
  if (photoPaths.length === 0) {
    return ok(0);
  }

  // 既にメタデータがある写真をスキップ
  let existingPaths: Set<string>;
  try {
    existingPaths = await getPhotoPathsWithMetadata();
  } catch (e) {
    return err({
      type: 'DB_ERROR',
      message: `Failed to query existing metadata: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  const newPaths = photoPaths.filter((p) => !existingPaths.has(p));
  if (newPaths.length === 0) {
    return ok(0);
  }

  logger.info(
    `Extracting metadata from ${newPaths.length} photos (${existingPaths.size} already processed)`,
  );

  // PNGファイルのみフィルタ（XMPメタデータはPNG/JPEGどちらにも存在し得る）
  const targetPaths = newPaths.filter(
    (p) => p.toLowerCase().endsWith('.png') || p.toLowerCase().endsWith('.jpg'),
  );

  if (targetPaths.length === 0) {
    return ok(0);
  }

  // バッチでメタデータ抽出
  const metadataMap = await parsePhotoMetadataBatch(
    targetPaths,
    getExifTagReader(),
    concurrency,
  );

  if (metadataMap.size === 0) {
    return ok(0);
  }

  // DB保存用の属性リストを構築
  const attributes: VRChatPhotoMetadataCreationAttributes[] = [];
  for (const [photoPath, metadata] of metadataMap) {
    attributes.push({
      photoPath,
      authorId: metadata.authorId,
      authorDisplayName: metadata.authorDisplayName,
      worldId: metadata.worldId,
      worldDisplayName: metadata.worldDisplayName,
    });
  }

  // DBに保存
  try {
    await createOrUpdatePhotoMetadataBatch(attributes);
  } catch (e) {
    return err({
      type: 'DB_ERROR',
      message: `Failed to save metadata: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  logger.info(`Saved metadata for ${attributes.length} photos`);
  return ok(attributes.length);
};

// ============================================================================
// クエリ関数
// ============================================================================

/**
 * 写真パスからメタデータを取得する
 */
export const getMetadataForPhoto = async (
  photoPath: string,
): Promise<VRChatPhotoMetadata | null> => {
  const record = await getPhotoMetadataByPhotoPath(photoPath);
  if (!record) {
    return null;
  }

  return {
    authorId: record.authorId ?? '',
    authorDisplayName: record.authorDisplayName ?? '',
    worldId: record.worldId,
    worldDisplayName: record.worldDisplayName,
  };
};

/**
 * 複数写真のメタデータをバッチ取得する
 */
export const getMetadataForPhotos = async (
  photoPaths: string[],
): Promise<Map<string, VRChatPhotoMetadata>> => {
  const records = await getPhotoMetadataByPhotoPaths(photoPaths);
  const result = new Map<string, VRChatPhotoMetadata>();

  for (const record of records) {
    result.set(record.photoPath, {
      authorId: record.authorId ?? '',
      authorDisplayName: record.authorDisplayName ?? '',
      worldId: record.worldId,
      worldDisplayName: record.worldDisplayName,
    });
  }

  return result;
};

/**
 * ワールドIDから写真メタデータを検索する
 *
 * メタデータベースのワールド紐付けに使用。
 * ログファイルに依存しない直接的なワールド紐付けが可能。
 */
export const getPhotosByWorldId = async (
  worldId: string,
): Promise<
  Array<{
    photoPath: string;
    worldDisplayName: string | null;
  }>
> => {
  const records = await getPhotoMetadataByWorldId(worldId);

  return records.map((record) => ({
    photoPath: record.photoPath,
    worldDisplayName: record.worldDisplayName,
  }));
};
