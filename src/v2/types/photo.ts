import {
  type VRChatPhotoFileNameWithExt,
  type VRChatPhotoPath,
  VRChatPhotoPathSchema,
} from './../../valueObjects';

/**
 * 写真データの共通プロパティ（基底インターフェース）
 *
 * Phase 1, Phase 2 両方で利用される基本情報。
 * これらのプロパティはハイブリッドローディングの初期段階から利用可能。
 *
 * @remarks
 * id は string 型（UUID）。DBモデル VRChatPhotoPathModel と一致。
 */
export interface PhotoBase {
  id: string;
  width: number;
  height: number;
  takenAt: Date;
  location: {
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
 * VRChatPhotoPathSchema でパスを検証し、VRChat写真形式でない場合はnullを返す。
 * 呼び出し元で適切にハンドリングすること。
 */
export function createFullyLoadedPhoto(
  metadata: PhotoMetadata,
  photoPathStr: string,
): PhotoFullyLoaded | null {
  const parseResult = VRChatPhotoPathSchema.safeParse(photoPathStr);

  if (!parseResult.success) {
    // VRChat写真形式でないファイル名の場合はnullを返す
    console.warn(
      `[createFullyLoadedPhoto] Invalid VRChat photo path: ${photoPathStr}`,
      parseResult.error.message,
    );
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
 * @returns Photo配列（無効なエントリは除外）
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
