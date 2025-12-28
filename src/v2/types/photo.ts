import {
  type VRChatPhotoFileNameWithExt,
  type VRChatPhotoPath,
  VRChatPhotoPathSchema,
} from './../../valueObjects';
import { logger } from '../lib/logger';

/**
 * 写真データの共通プロパティ（基底インターフェース）
 *
 * Phase 1, Phase 2 両方で利用される基本情報。
 * これらのプロパティはハイブリッドローディングの初期段階から利用可能。
 *
 * @remarks
 * - id は string 型（UUID）。DBモデル VRChatPhotoPathModel と一致。
 * - location.joinedAt は Phase 1 では photoTakenAt で近似される（実際のワールド参加時刻はログ解析が必要）
 */
export interface PhotoBase {
  id: string;
  width: number;
  height: number;
  takenAt: Date;
  /**
   * 写真の撮影場所に関する情報
   *
   * @remarks
   * Phase 1（メタデータのみ）では joinedAt は photoTakenAt で近似される。
   * 正確なワールド参加時刻はログファイル解析後にのみ取得可能。
   * グルーピングは takenAt を基準に行うため、近似値でも実用上の問題はない。
   */
  location: {
    /**
     * ワールドに参加した時刻
     *
     * @remarks
     * Phase 1: photoTakenAt で近似（ログ解析前のため）
     * Phase 2: 実際のワールド参加時刻（将来対応予定）
     */
    joinedAt: Date;
  };
}

/**
 * Phase 1: メタデータのみ（url/fileNameWithExt なし）
 *
 * ハイブリッドローディングの初期フェーズ。
 * 高さ計算・グルーピング・バーチャルスクロールに必要な情報のみ含む。
 * この状態ではサムネイル表示は不可（Skeleton等を表示）。
 *
 * メモリ効率: 写真10万枚で約5MB（通常の約74%削減）
 */
export interface PhotoMetadataOnly extends PhotoBase {
  loadingState: 'metadata';
  /** photoPath は存在しない（型レベルで保証） */
  photoPath?: never;
  /** fileNameWithExt は存在しない（型レベルで保証） */
  fileNameWithExt?: never;
}

/**
 * Phase 2: 完全ロード済み
 *
 * 表示に必要な全ての情報を含む完全な写真データ。
 * サムネイル表示・ファイル操作が可能。
 */
export interface PhotoFullyLoaded extends PhotoBase {
  loadingState: 'loaded';
  /** 写真ファイルのフルパス（検証済みVRChat写真パス） */
  photoPath: VRChatPhotoPath;
  /** ファイル名（photoPathから派生） */
  fileNameWithExt: VRChatPhotoFileNameWithExt;
}

/**
 * 写真データの型定義（Discriminated Union）
 *
 * ## ハイブリッドローディング対応
 * loadingState で型を判別:
 * - 'metadata': Phase 1 - メタデータのみ
 * - 'loaded': Phase 2 - 完全ロード済み
 *
 * ## 型安全な使用例
 * ```ts
 * if (isPhotoLoaded(photo)) {
 *   // photo.photoPath が VRChatPhotoPath 型として推論される
 *   console.log(photo.photoPath.value);
 * }
 *
 * // または ts-pattern で
 * match(photo)
 *   .with({ loadingState: 'loaded' }, (p) => <img src={p.photoPath.value} />)
 *   .with({ loadingState: 'metadata' }, () => <Skeleton />)
 *   .exhaustive();
 * ```
 *
 * @see useHybridPhotoLoading - ハイブリッドローディングフック
 */
export type Photo = PhotoMetadataOnly | PhotoFullyLoaded;

/**
 * 型ガード: 写真が完全にロードされているか判定
 *
 * @param photo 判定対象の写真
 * @returns true の場合、photo は PhotoFullyLoaded 型として推論される
 */
export function isPhotoLoaded(photo: Photo): photo is PhotoFullyLoaded {
  return photo.loadingState === 'loaded';
}

// ============================================================================
// ファクトリ関数
// ============================================================================

/**
 * 軽量メタデータ型（Phase 1で取得）
 *
 * DBから取得した最小限のデータ。photoPathを含まないことでメモリ削減。
 */
export interface PhotoMetadata {
  id: string;
  photoTakenAt: Date;
  width: number;
  height: number;
}

/**
 * メタデータからPhotoMetadataOnly型を生成
 *
 * @param metadata DBから取得した軽量メタデータ
 * @returns Phase 1のPhoto（loadingState: 'metadata'）
 *
 * @remarks
 * location.joinedAt は photoTakenAt で近似される。
 * これはログ解析を行わずに高速にメタデータを取得するためのトレードオフ。
 * グルーピングは takenAt を基準に行うため、実用上の問題はない。
 */
export function createMetadataOnlyPhoto(
  metadata: PhotoMetadata,
): PhotoMetadataOnly {
  return {
    loadingState: 'metadata',
    id: metadata.id,
    width: metadata.width,
    height: metadata.height,
    takenAt: metadata.photoTakenAt,
    location: {
      // Note: 実際のワールド参加時刻はログ解析が必要。
      // ここでは photoTakenAt で近似する。
      joinedAt: metadata.photoTakenAt,
    },
  };
}

/**
 * メタデータとパスからPhotoFullyLoaded型を生成
 *
 * @param metadata DBから取得した軽量メタデータ
 * @param photoPathStr 写真ファイルのフルパス（文字列）
 * @returns Phase 2のPhoto、またはファイル名が無効な場合はnull
 *
 * @remarks
 * - VRChatPhotoPathSchema でパスを検証し、VRChat写真形式でない場合はnullを返す
 * - location.joinedAt は現時点では photoTakenAt で近似（将来的にログ解析結果を使用予定）
 */
export function createFullyLoadedPhoto(
  metadata: PhotoMetadata,
  photoPathStr: string,
): PhotoFullyLoaded | null {
  const parseResult = VRChatPhotoPathSchema.safeParse(photoPathStr);

  if (!parseResult.success) {
    // VRChat写真形式でないファイル名の場合はnullを返す
    logger.warn({
      message: 'Invalid VRChat photo path in createFullyLoadedPhoto',
      details: {
        photoPath: photoPathStr,
        zodError: parseResult.error.message,
      },
    });
    return null;
  }

  const photoPath = parseResult.data;

  return {
    loadingState: 'loaded',
    id: metadata.id,
    photoPath,
    fileNameWithExt: photoPath.fileName,
    width: metadata.width,
    height: metadata.height,
    takenAt: metadata.photoTakenAt,
    location: {
      // Note: 将来的にはログ解析から取得した実際のワールド参加時刻を使用予定
      joinedAt: metadata.photoTakenAt,
    },
  };
}

/**
 * メタデータ配列からPhoto配列を生成
 *
 * パスがキャッシュされていればFullyLoaded、なければMetadataOnlyを返す。
 * ハイブリッドローディングのUI構築に使用。
 *
 * @param metadataList メタデータ配列
 * @param pathCache id -> photoPath のマッピング
 * @returns Photo配列（VRChat写真形式でないパスを持つエントリは除外される）
 */
export function createPhotoArray(
  metadataList: PhotoMetadata[],
  pathCache: Map<string, string>,
): Photo[] {
  return metadataList
    .map((metadata) => {
      const photoPath = pathCache.get(metadata.id);
      if (photoPath) {
        return createFullyLoadedPhoto(metadata, photoPath);
      }
      return createMetadataOnlyPhoto(metadata);
    })
    .filter((photo): photo is Photo => photo !== null);
}
