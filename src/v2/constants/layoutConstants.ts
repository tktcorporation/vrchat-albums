/**
 * PhotoGrid のレイアウト計算で使用する定数値を一元管理
 *
 * これらの定数は PhotoGrid, GalleryContent, JustifiedLayoutCalculator で
 * 共通して使用され、データ整合性を保つために一箇所で管理される。
 */
interface LayoutConstants {
  TARGET_ROW_HEIGHT: number;
  GAP: number;
  HEADER_HEIGHT: number;
  SPACING: number;
  MAX_LAST_ROW_SCALE: number;
  GALLERY_CONTAINER_PADDING: number;
}
export const LAYOUT_CONSTANTS: LayoutConstants = {
  /** 写真グリッドの目標行高さ (px) */
  TARGET_ROW_HEIGHT: 200,

  /** 写真間のギャップ (px) - Tailwind gap-1.5 に対応 */
  GAP: 6,

  /** LocationGroupHeader の高さ (px) - py-4 + 内部コンテンツの近似値 */
  HEADER_HEIGHT: 80,

  /** ヘッダーとグリッド間のスペース (px) - ヘッダーとグリッド間の余白 */
  SPACING: 0,

  /** 最後の行の最大スケール倍率 */
  MAX_LAST_ROW_SCALE: 1.5,

  /** GalleryContent のコンテナ padding (px) - Tailwind の p-4 (16px × 2) に対応 */
  GALLERY_CONTAINER_PADDING: 32,
} as const;

export type { LayoutConstants };
