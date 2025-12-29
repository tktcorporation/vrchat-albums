import {
  type VRChatPhotoFileNameWithExt,
  type VRChatPhotoPath,
  VRChatPhotoPathSchema,
} from './../../valueObjects';
import { logger } from '../lib/logger';

/**
 * 写真データの共通プロパティ（基底インターフェース）
 *
 * 軽量メタデータ・完全ロード両方で利用される基本情報。
 * これらのプロパティはハイブリッドローディングの初期段階から利用可能。
 *
 * @remarks
 * - id は string 型（UUID）。DBモデル VRChatPhotoPathModel と一致。
 * - location.joinedAt は軽量メタデータ取得時は photoTakenAt で近似される（実際のワールド参加時刻はログ解析が必要）
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
   * 軽量メタデータ取得時は joinedAt は photoTakenAt で近似される。
   * 正確なワールド参加時刻はログファイル解析後にのみ取得可能。
   * グルーピングは takenAt を基準に行うため、近似値でも実用上の問題はない。
   */
  location: {
    /**
     * ワールドに参加した時刻
     *
     * @remarks
     * 軽量メタデータ: photoTakenAt で近似（ログ解析前のため）
     * 完全ロード: 実際のワールド参加時刻（将来対応予定）
     */
    joinedAt: Date;
  };
}

/**
 * 軽量メタデータ状態（パス未取得）
 *
 * ハイブリッドローディングの初期状態。
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
 * 完全ロード状態（パス取得済み）
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
 * - 'metadata': 軽量メタデータ状態（パス未取得）
 * - 'loaded': 完全ロード状態（パス取得済み）
 *
 * ## 型安全な使用例
 * ```ts
 * if (isPhotoLoaded(photo)) {
 *   // photo.photoPath が VRChatPhotoPath 型として推論される
 *   // サムネイル取得には useThumbnail フックを使用
 *   const thumbnail = useThumbnail(photo.photoPath.value);
 *   return thumbnail ? <img src={thumbnail} /> : <Skeleton />;
 * }
 *
 * // または ts-pattern で loadingState をチェック
 * match(photo)
 *   .with({ loadingState: 'loaded' }, (p) => {
 *     // p.photoPath.value はファイルパス（直接 img src には使えない）
 *     // サムネイルは useThumbnail(p.photoPath.value) で取得
 *     return <PhotoCard photo={p} />;
 *   })
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
 * 軽量メタデータ型（初回クエリで取得）
 *
 * DBから取得した最小限のデータ。photoPathを含まないことでメモリ削減。
 *
 * @remarks
 * バックエンド側に同等の型 VRChatPhotoMetadata が存在する。
 * tRPC の Date→string 変換があるため、フロントエンド専用として維持。
 *
 * @see electron/module/vrchatPhoto/model/vrchatPhotoPath.model.ts - VRChatPhotoMetadata
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
 * @returns 軽量メタデータ状態のPhoto（loadingState: 'metadata'）
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
 * @returns 完全ロード状態のPhoto、またはファイル名が無効な場合はnull
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
 * 無効なパスのレポート用コールバック型
 */
export type InvalidPathCallback = (id: string, path: string) => void;

/**
 * createPhotoArray のオプション
 */
export interface CreatePhotoArrayOptions {
  /**
   * 無効なパスが検出された際のコールバック
   * 指定しない場合は、無効なパスはサマリーログとしてのみ記録される
   */
  onInvalidPath?: InvalidPathCallback;
}

/**
 * メタデータ配列からPhoto配列を生成
 *
 * パスがキャッシュされていればFullyLoaded、なければMetadataOnlyを返す。
 * ハイブリッドローディングのUI構築に使用。
 *
 * @param metadataList メタデータ配列
 * @param pathCache id -> photoPath のマッピング
 * @param options オプション（無効パス検出時のコールバック等）
 * @returns Photo配列（VRChat写真形式でないパスを持つエントリは除外される）
 *
 * @remarks
 * VRChat写真形式でないパスが検出された場合:
 * - onInvalidPath が指定されていれば各パスについてコールバック
 * - 最終的に除外された件数をサマリーログとして記録
 */
export function createPhotoArray(
  metadataList: PhotoMetadata[],
  pathCache: Map<string, string>,
  options: CreatePhotoArrayOptions = {},
): Photo[] {
  const { onInvalidPath } = options;
  const invalidPaths: Array<{ id: string; path: string }> = [];

  const photos = metadataList
    .map((metadata) => {
      const photoPath = pathCache.get(metadata.id);
      if (photoPath) {
        const loaded = createFullyLoadedPhoto(metadata, photoPath);
        if (loaded === null) {
          // 無効なパスをトラッキング
          invalidPaths.push({ id: metadata.id, path: photoPath });
          onInvalidPath?.(metadata.id, photoPath);
        }
        return loaded;
      }
      return createMetadataOnlyPhoto(metadata);
    })
    .filter((photo): photo is Photo => photo !== null);

  // 無効なパスがあった場合はサマリーログを出力
  if (invalidPaths.length > 0) {
    logger.warn({
      message: `createPhotoArray: ${invalidPaths.length} photos with invalid paths were filtered out`,
      details: {
        filteredCount: invalidPaths.length,
        totalCount: metadataList.length,
        // サンプルとして最初の3件を記録
        samplePaths: invalidPaths.slice(0, 3).map((p) => ({
          id: p.id,
          path: p.path,
        })),
      },
    });
  }

  return photos;
}
