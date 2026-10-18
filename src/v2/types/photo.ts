import type {
  VRChatPhotoFileNameWithExt,
  VRChatPhotoPath,
} from './../../valueObjects';

/**
 * 写真データの共通プロパティ（基底インターフェース）
 *
 * 軽量メタデータ・完全ロード両方で利用される基本情報。
 * これらのプロパティはハイブリッドローディングの初期段階から利用可能。
 *
 * @description
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
   * @description
   * 軽量メタデータ取得時は joinedAt は photoTakenAt で近似される。
   * 正確なワールド参加時刻はログファイル解析後にのみ取得可能。
   * グルーピングは takenAt を基準に行うため、近似値でも実用上の問題はない。
   */
  location: {
    /**
     * ワールドに参加した時刻
     *
     * @description
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
