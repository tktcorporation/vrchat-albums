import type { VRChatPhotoFileNameWithExt } from './../../valueObjects';

/**
 * 写真データの型定義
 *
 * ## ハイブリッドローディング対応
 * メモリ効率のため、url と fileNameWithExt は遅延ロードされる場合がある:
 * - Phase 1: id, width, height, takenAt のみ（高さ計算・グルーピング用）
 * - Phase 2: url, fileNameWithExt（表示時に遅延ロード）
 *
 * @see useHybridPhotoLoading - ハイブリッドローディングフック
 */
export interface Photo {
  id: number | string;
  /** 写真のパス（ハイブリッドローディング時は遅延ロード） */
  url?: string;
  /** ファイル名（urlから派生、遅延ロード） */
  fileNameWithExt?: VRChatPhotoFileNameWithExt;
  width: number;
  height: number;
  takenAt: Date;
  location: {
    joinedAt: Date;
  };
}
