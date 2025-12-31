import { LAYOUT_CONSTANTS } from '../constants/layoutConstants';
import type { Photo } from '../types/photo';
import { JustifiedLayoutCalculator } from './justifiedLayoutCalculator';

/**
 * グループの高さ推定に関する定数
 */
export const GROUP_HEIGHT_CONSTANTS = {
  /** バーチャルスクロールのグループ間スペース (px) */
  GROUP_SPACING: 32,
  /** 写真がない場合のフォールバック高さ (px) */
  FALLBACK_EMPTY_HEIGHT:
    LAYOUT_CONSTANTS.HEADER_HEIGHT + LAYOUT_CONSTANTS.SPACING,
} as const;

/**
 * グループの高さ推定結果
 */
export interface GroupHeightEstimate {
  /** 推定された高さ (px) */
  height: number;
  /** 推定方法 */
  source: 'cache' | 'calculated' | 'fallback';
}

/**
 * 写真グループの高さを推定する
 *
 * バーチャルスクロールの `estimateSize` で使用される。
 * キャッシュがある場合はそれを使用し、なければ写真データから計算する。
 *
 * ## 優先順位
 * 1. キャッシュされた実測値（最も正確）
 * 2. 写真データからの計算値（正確だが計算コストあり）
 * 3. フォールバック値（写真がない場合）
 *
 * @param photos - グループ内の写真配列
 * @param containerWidth - コンテナの幅（ValidWidth 型により > 0 が保証される）
 * @param cachedHeight - キャッシュされた高さ（あれば）
 * @param calculator - レイアウト計算機のインスタンス（再利用のため外部から渡す）
 * @returns 推定高さと推定方法
 */
export function estimateGroupHeight(
  photos: Photo[],
  containerWidth: number,
  cachedHeight: number | undefined,
  calculator?: JustifiedLayoutCalculator,
): GroupHeightEstimate {
  // 1. キャッシュがあればそれを使用
  if (cachedHeight !== undefined && cachedHeight > 0) {
    return {
      height: cachedHeight + GROUP_HEIGHT_CONSTANTS.GROUP_SPACING,
      source: 'cache',
    };
  }

  // 2. 写真がない場合はフォールバック
  if (photos.length === 0) {
    return {
      height:
        GROUP_HEIGHT_CONSTANTS.FALLBACK_EMPTY_HEIGHT +
        GROUP_HEIGHT_CONSTANTS.GROUP_SPACING,
      source: 'fallback',
    };
  }

  // 3. 計算機がなければ新規作成
  // Note: containerWidth > 0 は ValidWidth 型によりコンポーネント層で保証される
  const calc = calculator ?? new JustifiedLayoutCalculator();
  const calculatedHeight = calc.calculateTotalHeight(photos, containerWidth);

  return {
    height: calculatedHeight + GROUP_HEIGHT_CONSTANTS.GROUP_SPACING,
    source: 'calculated',
  };
}

/**
 * 複数グループの高さを一括で事前計算する
 *
 * 初回レンダリング時に全グループの高さを計算してキャッシュを初期化するのに使用。
 * これにより、一気にスクロールした際のレイアウトシフトを軽減できる。
 *
 * @param groups - グループの配列（[key, photos] のタプル）
 * @param containerWidth - コンテナの幅
 * @param existingCache - 既存のキャッシュ（更新される）
 * @returns 更新されたキャッシュ
 */
export function precomputeGroupHeights(
  groups: Array<{ key: string; photos: Photo[] }>,
  containerWidth: number,
  existingCache: Map<string, number> = new Map(),
): Map<string, number> {
  // Note: containerWidth > 0 は ValidWidth 型によりコンポーネント層で保証される
  const calculator = new JustifiedLayoutCalculator();

  for (const { key, photos } of groups) {
    // 既にキャッシュにある場合はスキップ
    if (existingCache.has(key)) {
      continue;
    }

    const height = calculator.calculateTotalHeight(photos, containerWidth);
    existingCache.set(key, height);
  }

  return existingCache;
}
