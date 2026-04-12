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
import { readXmpTags, readXmpTagsBatch } from '../../lib/wrappedExifTool';
import {
  MetadataDbError,
  type MetadataParseError,
  type NoMetadataFound,
} from './errors';
import { extractOfficialMetadata, parsePhotoMetadata } from './parser';
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
// サービス関数
// ============================================================================

/**
 * 単一の写真からメタデータを抽出する
 */
export const extractMetadataFromPhoto = (
  photoPath: string,
): Effect.Effect<VRChatPhotoMetadata, NoMetadataFound | MetadataParseError> => {
  // readXmpTags (Effect) → Promise アダプター。parsePhotoMetadata が Promise を要求するため。
  const exifTagReader = (
    fp: string,
    // biome-ignore lint/suspicious/noExplicitAny: exiftool Tags の型は広すぎるため any で受ける
  ): Promise<Record<string, any>> =>
    // biome-ignore lint/suspicious/noExplicitAny: exiftool.Tags は Record<string, any> と互換
    Effect.runPromise(readXmpTags(fp)) as Promise<Record<string, any>>;
  return parsePhotoMetadata(photoPath, exifTagReader);
};

/** バッチ処理の進捗をログ出力する間隔（ファイル数） */
const PROGRESS_LOG_INTERVAL = 100;

/**
 * 複数の写真からメタデータを抽出してDBに保存する
 *
 * 差分処理: 既にメタデータ抽出済みの写真はスキップする。
 * 写真インデックス作成時（loadLogInfoIndexFromVRChatLog）から呼び出される。
 *
 * 背景: 従来は parsePhotoMetadataBatch で1ファイルずつ readXmpTags を呼んでいたが、
 * readXmpTagsBatch で Rust 側の Rayon 全コア並列 + 部分読み込みを一発呼びに変更。
 * N-API 境界の往復を N 回→1 回に削減し、I/O もファイルヘッダーだけ読む。
 *
 * @returns 新たに抽出・保存したメタデータの件数
 */
export const extractAndSaveMetadataBatch = (
  photoPaths: string[],
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

    // VRChat 2025.3.1 で XMP メタデータが導入されたため、それ以前の写真をスキップ。
    // カットオフを 2025-01-01 に設定（余裕を持たせる）。
    const METADATA_CUTOFF_DATE = '2025-01-01';
    const dateFilteredPaths = newPaths.filter((p) => {
      const match = p.match(/VRChat_(\d{4}-\d{2}-\d{2})/);
      // パターンにマッチしないファイルは安全側に倒して除外しない
      return !match || match[1] >= METADATA_CUTOFF_DATE;
    });

    // PNG/JPEGファイルのみフィルタ（XMPメタデータはPNG/JPEGどちらにも存在し得る）
    const targetPaths = dateFilteredPaths.filter((p) => {
      const lower = p.toLowerCase();
      return (
        lower.endsWith('.png') ||
        lower.endsWith('.jpg') ||
        lower.endsWith('.jpeg')
      );
    });

    const skippedByDb = photoPaths.length - newPaths.length;
    const skippedByDate = newPaths.length - dateFilteredPaths.length;
    const skippedByExt = dateFilteredPaths.length - targetPaths.length;
    logger.info(
      `Photo metadata: ${targetPaths.length} to extract (${skippedByDb} already in DB, ${skippedByDate} before ${METADATA_CUTOFF_DATE}, ${skippedByExt} unsupported format)`,
    );

    if (targetPaths.length === 0) {
      return 0;
    }

    // Rust バッチ呼び出し: Rayon 全コア並列 + 部分読み込みで XMP を抽出。
    // AsyncTask で libuv スレッドプール上で実行するため、メインスレッドをブロックしない。
    logger.info(`Metadata extraction starting: ${targetPaths.length} files`);
    const batchResults = yield* Effect.tryPromise({
      try: () => readXmpTagsBatch(targetPaths),
      catch: (e): MetadataDbError =>
        new MetadataDbError({
          message: `readXmpTagsBatch failed: ${e instanceof Error ? e.message : String(e)}`,
        }),
    });

    // Rust の結果を Zod バリデーション付きでパース。
    // JsVrcXmpBatchResult でエラーと「XMP なし」を区別する:
    //   data あり → XMP 抽出成功
    //   data なし, error なし → XMP が存在しない（正常）
    //   data なし, error あり → I/O エラー等
    const attributes: VRChatPhotoMetadataCreationAttributes[] = [];
    let processed = 0;
    let noXmpCount = 0;
    let errorCount = 0;
    /** Zod 検証で reject された件数（data はあるが extractOfficialMetadata が null を返した） */
    let zodRejectCount = 0;
    for (let i = 0; i < targetPaths.length; i++) {
      const entry = batchResults[i];
      if (entry) {
        const { data, error } = entry;
        if (error) {
          errorCount++;
          // I/O エラーは debug レベルで個別ログ（大量出力を防ぐ）
          logger.debug(`XMP read error: ${targetPaths[i]}: ${error}`);
        } else if (data) {
          // extractOfficialMetadata で Zod 検証 + フィールド正規化
          const tags = {
            AuthorID: data.authorId ?? undefined,
            Author: data.author ?? undefined,
            WorldID: data.worldId ?? undefined,
            WorldDisplayName: data.worldDisplayName ?? undefined,
          };
          const metadata = extractOfficialMetadata(tags);
          if (metadata === null) {
            zodRejectCount++;
            logger.debug(
              `XMP data found but Zod validation rejected: ${targetPaths[i]}`,
              { tags },
            );
          } else {
            attributes.push({
              photoPath: targetPaths[i],
              authorId: metadata.authorId,
              authorDisplayName: metadata.authorDisplayName,
              worldId: metadata.worldId,
              worldDisplayName: metadata.worldDisplayName,
            });
          }
        } else {
          noXmpCount++;
        }
      } else {
        // Rayon 側で予期しないエラー（パニック等）により結果が欠落した場合
        errorCount++;
      }
      processed++;
      if (
        processed % PROGRESS_LOG_INTERVAL === 0 ||
        processed === targetPaths.length
      ) {
        logger.info(
          `Metadata extraction progress: ${processed}/${targetPaths.length}`,
        );
      }
    }

    // サマリーログ: 結果の内訳を出力（問題切り分け用）
    logger.info(
      `Photo metadata results: ${attributes.length} extracted, ${noXmpCount} no XMP, ${errorCount} errors, ${zodRejectCount} Zod rejected (total: ${targetPaths.length})`,
    );
    if (errorCount > 0) {
      logger.warn(
        `Photo metadata: ${errorCount}/${targetPaths.length} files had read errors`,
      );
    }

    if (attributes.length === 0) {
      return 0;
    }

    // DBに保存
    yield* Effect.tryPromise({
      try: () => createOrUpdatePhotoMetadataBatch(attributes),
      catch: (e) =>
        new MetadataDbError({
          message: `Failed to save metadata: ${e instanceof Error ? e.message : String(e)}`,
        }),
    });

    // 読み取り結果のサマリー（XMP の各フィールドが正しく取れているか確認用）
    const withWorldId = attributes.filter((a) => a.worldId !== null).length;
    const withWorldName = attributes.filter(
      (a) => a.worldDisplayName !== null,
    ).length;
    logger.info(
      `Photo metadata complete: ${attributes.length} found with XMP out of ${targetPaths.length} scanned (worldId: ${withWorldId}, worldName: ${withWorldName})`,
    );
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
