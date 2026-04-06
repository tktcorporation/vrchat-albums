/**
 * VRChat 写真メタデータサービス
 *
 * VRChat公式XMPメタデータの抽出・保存・取得を管理するサービス層。
 * パーサーとDBモデルの間を仲介する。
 *
 * 呼び出し元: 写真インデックス作成時、tRPC コントローラー
 */

import { Effect } from 'effect';

import { logger } from '../../lib/logger';
import { readExif } from '../../lib/wrappedExifTool';
import {
  MetadataDbError,
  type MetadataParseError,
  type NoMetadataFound,
} from './errors';
import { parsePhotoMetadata, parsePhotoMetadataBatch } from './parser';
import type { VRChatPhotoMetadata } from './schema';
import {
  createOrUpdatePhotoMetadataBatch,
  filterPathsWithoutMetadata,
  getPhotoMetadataByPhotoPath,
  getPhotoMetadataByPhotoPaths,
  getPhotoMetadataByWorldId,
  type VRChatPhotoMetadataCreationAttributes,
} from './vrchatPhotoMetadata.model';

// ============================================================================
// ExifTool アダプター
// ============================================================================

/**
 * wrappedExifTool.readExif を parser の ExifTagReader 型に適合させるキャスト。
 * readExif は exiftool-vendored の Tags を返すが、parser は Record<string, any> を期待する。
 * プロセスのライフサイクル管理は wrappedExifTool 側で行われる。
 */
const exifTagReader = readExif as (
  filePath: string,
  // biome-ignore lint/suspicious/noExplicitAny: parser が Record<string, any> を期待するため
) => Promise<Record<string, any>>;

// ============================================================================
// サービス関数
// ============================================================================

/**
 * 単一の写真からメタデータを抽出する
 */
export const extractMetadataFromPhoto = (
  photoPath: string,
): Effect.Effect<VRChatPhotoMetadata, NoMetadataFound | MetadataParseError> => {
  return parsePhotoMetadata(photoPath, exifTagReader);
};

/**
 * 複数の写真からメタデータを抽出してDBに保存する
 *
 * 差分処理: 既にメタデータ抽出済みの写真はスキップする。
 * 写真インデックス作成時（loadLogInfoIndexFromVRChatLog）から呼び出される。
 *
 * @returns 新たに抽出・保存したメタデータの件数
 */
export const extractAndSaveMetadataBatch = (
  photoPaths: string[],
  concurrency = 5,
): Effect.Effect<number, MetadataDbError> =>
  Effect.gen(function* () {
    if (photoPaths.length === 0) {
      return 0;
    }

    // 既にメタデータがある写真をスキップ（SQL側でフィルタ、全件メモリロードを回避）
    const newPaths = yield* Effect.tryPromise({
      try: () => filterPathsWithoutMetadata(photoPaths),
      catch: (e) =>
        new MetadataDbError({
          message: `Failed to filter existing metadata: ${e instanceof Error ? e.message : String(e)}`,
        }),
    });

    if (newPaths.length === 0) {
      return 0;
    }

    logger.info(
      `Extracting metadata from ${newPaths.length} photos (${photoPaths.length - newPaths.length} already processed)`,
    );

    // PNG/JPEGファイルのみフィルタ（XMPメタデータはPNG/JPEGどちらにも存在し得る）
    const targetPaths = newPaths.filter(
      (p) =>
        p.toLowerCase().endsWith('.png') || p.toLowerCase().endsWith('.jpg'),
    );

    if (targetPaths.length === 0) {
      return 0;
    }

    // バッチでメタデータ抽出（進捗ログ付き）
    const metadataMap = yield* Effect.promise(() =>
      parsePhotoMetadataBatch(
        targetPaths,
        exifTagReader,
        concurrency,
        (processed, total, errors) => {
          const errorSuffix = errors > 0 ? ` (${errors} errors)` : '';
          logger.info(
            `Metadata extraction progress: ${processed}/${total}${errorSuffix}`,
          );
        },
      ),
    );

    if (metadataMap.size === 0) {
      return 0;
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
    yield* Effect.tryPromise({
      try: () => createOrUpdatePhotoMetadataBatch(attributes),
      catch: (e) =>
        new MetadataDbError({
          message: `Failed to save metadata: ${e instanceof Error ? e.message : String(e)}`,
        }),
    });

    logger.info(`Saved metadata for ${attributes.length} photos`);
    return attributes.length;
  });

// ============================================================================
// クエリ関数
// ============================================================================

/**
 * 写真パスからメタデータを取得する
 *
 * 呼び出し元: tRPC getPhotoMetadata エンドポイント
 */
export const getMetadataForPhoto = (
  photoPath: string,
): Effect.Effect<VRChatPhotoMetadata | null, MetadataDbError> =>
  Effect.gen(function* () {
    const record = yield* Effect.tryPromise({
      try: () => getPhotoMetadataByPhotoPath(photoPath),
      catch: (e) =>
        new MetadataDbError({
          message: `Failed to get metadata for photo: ${e instanceof Error ? e.message : String(e)}`,
        }),
    });

    if (!record) {
      return null;
    }

    return {
      authorId: record.authorId,
      authorDisplayName: record.authorDisplayName,
      worldId: record.worldId,
      worldDisplayName: record.worldDisplayName,
    };
  });

/**
 * 複数写真のメタデータをバッチ取得する
 *
 * 呼び出し元: tRPC getPhotoMetadataBatch エンドポイント
 */
export const getMetadataForPhotos = (
  photoPaths: string[],
): Effect.Effect<Map<string, VRChatPhotoMetadata>, MetadataDbError> =>
  Effect.gen(function* () {
    const records = yield* Effect.tryPromise({
      try: () => getPhotoMetadataByPhotoPaths(photoPaths),
      catch: (e) =>
        new MetadataDbError({
          message: `Failed to get metadata for photos: ${e instanceof Error ? e.message : String(e)}`,
        }),
    });

    const metadataMap = new Map<string, VRChatPhotoMetadata>();
    for (const record of records) {
      metadataMap.set(record.photoPath, {
        authorId: record.authorId,
        authorDisplayName: record.authorDisplayName,
        worldId: record.worldId,
        worldDisplayName: record.worldDisplayName,
      });
    }

    return metadataMap;
  });

/**
 * ワールドIDから写真メタデータを検索する
 *
 * メタデータベースのワールド紐付けに使用。
 * ログファイルに依存しない直接的なワールド紐付けが可能。
 *
 * 呼び出し元: tRPC getPhotosByWorldId エンドポイント
 */
export const getPhotosByWorldId = (
  worldId: string,
): Effect.Effect<
  {
    photoPath: string;
    worldDisplayName: string | null;
  }[],
  MetadataDbError
> =>
  Effect.gen(function* () {
    const records = yield* Effect.tryPromise({
      try: () => getPhotoMetadataByWorldId(worldId),
      catch: (e) =>
        new MetadataDbError({
          message: `Failed to get photos by world ID: ${e instanceof Error ? e.message : String(e)}`,
        }),
    });

    return records.map((record) => ({
      photoPath: record.photoPath,
      worldDisplayName: record.worldDisplayName,
    }));
  });
