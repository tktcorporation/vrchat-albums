import type { VRChatPhotoFileNameWithExt } from './../../valueObjects';

/**
 * 写真データの共通プロパティ（基底インターフェース）
 *
 * Phase 1, Phase 2 両方で利用される基本情報。
 * これらのプロパティはハイブリッドローディングの初期段階から利用可能。
 */
export interface PhotoBase {
  id: number | string;
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
  /** url は存在しない（型レベルで保証） */
  url?: never;
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
  /** 写真のパス */
  url: string;
  /** ファイル名（urlから派生） */
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
 *   // photo.url と photo.fileNameWithExt が string 型として推論される
 *   console.log(photo.url);
 * }
 *
 * // または ts-pattern で
 * match(photo)
 *   .with({ loadingState: 'loaded' }, (p) => <img src={p.url} />)
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
