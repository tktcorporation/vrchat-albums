/**
 * PhotoGrid のレイアウト計算で使用する定数値を一元管理
 *
 * これらの定数は PhotoGrid, MeasurePhotoGroup, JustifiedLayoutCalculator で
 * 共通して使用され、データ整合性を保つために一箇所で管理される。
 */
interface LayoutConstants {
  TARGET_ROW_HEIGHT: number;
  GAP: number;
  HEADER_HEIGHT: number;
  SPACING: number;
  MAX_LAST_ROW_SCALE: number;
}
export const LAYOUT_CONSTANTS: LayoutConstants = {
  /** 写真グリッドの目標行高さ (px) */
  TARGET_ROW_HEIGHT: 200,

  /** 写真間のギャップ (px) */
  GAP: 4,

  /** LocationGroupHeader の高さ (px) - Tailwind の h-24 に対応 */
  HEADER_HEIGHT: 96,

  /** ヘッダーとグリッド間のスペース (px) - Tailwind の space-y-2 に対応 */
  SPACING: 8,

  /** 最後の行の最大スケール倍率 */
  MAX_LAST_ROW_SCALE: 1.5,
} as const;

export type { LayoutConstants };
