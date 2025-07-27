import clsx from 'clsx';
import { useMemo } from 'react';
import { useContainerWidth } from '../hooks/useContainerWidth';
import type { Photo } from '../types/photo';
import { JustifiedLayoutCalculator } from '../utils/justifiedLayoutCalculator';
import PhotoCard from './PhotoCard';

/**
 * PhotoGrid コンポーネントのプロパティ定義
 */
interface PhotoGridProps {
  /** 表示する写真オブジェクトの配列 */
  photos: Photo[];
  /** 現在選択されている写真のIDセット */
  selectedPhotos: Set<string>;
  /** 選択されている写真のIDセットを更新する関数 */
  setSelectedPhotos: (
    update: Set<string> | ((prev: Set<string>) => Set<string>),
  ) => void;
  /** 現在複数選択モードかどうか */
  isMultiSelectMode: boolean;
  /** 複数選択モードの有効/無効を設定する関数 */
  setIsMultiSelectMode: (value: boolean) => void;
  /** 選択された写真をコピーする関数（全グループにアクセス可能） */
  onCopySelected?: () => void;
}

/**
 * 写真をレスポンシブなグリッドレイアウトで表示するコンポーネント。
 * 各写真は PhotoCard としてレンダリングされます。
 *
 * ## 統一されたレイアウトアルゴリズム
 *
 * このコンポーネントは JustifiedLayoutCalculator を使用して
 * Google Photos 風の行ベースレイアウトを実装します。
 *
 * ### レイアウト計算の流れ
 *
 * 1. **コンテナ幅の監視**
 *    - useContainerWidth フックでコンテナ幅の変化をリアルタイムに検知
 *    - 幅が変化するたびにレイアウトを再計算
 *
 * 2. **統一されたレイアウト計算**
 *    - JustifiedLayoutCalculator.calculateLayout() で行ベース配置を計算
 *    - MeasurePhotoGroup と同じアルゴリズムを使用してデータ整合性を保証
 *
 * 3. **最適化されたレンダリング**
 *    - useMemo でレイアウト計算をメモ化
 *    - 不要な再計算を避けてスムーズなスクロールを実現
 *
 * ### バーチャルスクロールとの連携
 *
 * - **データ整合性**: MeasurePhotoGroup と同じ JustifiedLayoutCalculator を使用
 * - **高さの一致**: 予測値と実測値の差を最小化
 * - **パフォーマンス**: 共通化されたロジックで効率的な計算
 *
 * @note レイアウト定数は LAYOUT_CONSTANTS で一元管理され、
 * 計算ロジックは JustifiedLayoutCalculator で統一されています。
 */
export default function PhotoGrid({
  photos,
  selectedPhotos,
  setSelectedPhotos,
  isMultiSelectMode,
  setIsMultiSelectMode,
  onCopySelected,
}: PhotoGridProps) {
  const { containerRef, containerWidth } = useContainerWidth();
  const calculator = useMemo(() => new JustifiedLayoutCalculator(), []);

  // コンテナ幅または写真リストが変わったらレイアウトを再計算
  const layout = useMemo(() => {
    const result = calculator.calculateLayout(photos, containerWidth);
    return result.rows;
  }, [calculator, photos, containerWidth]);

  return (
    <div ref={containerRef} className="w-full">
      <div className="space-y-1">
        {layout.map((row, rowIndex) => {
          const rowKey = `row-${rowIndex}-${row[0]?.id}`;
          return (
            <div
              key={rowKey}
              className="flex gap-1"
              style={{
                height: row[0]?.displayHeight ?? 200,
              }}
            >
              {row.map((photo, index) => {
                const photoKey = `photo-${rowIndex}-${photo.id}-${index}`;
                return (
                  <div
                    key={photoKey}
                    style={{
                      width: photo.displayWidth,
                      flexShrink: 0,
                    }}
                    className={clsx('relative transition-all duration-300')}
                  >
                    <PhotoCard
                      photo={photo}
                      priority={index === 0}
                      selectedPhotos={selectedPhotos}
                      setSelectedPhotos={setSelectedPhotos}
                      photos={photos}
                      isMultiSelectMode={isMultiSelectMode}
                      setIsMultiSelectMode={setIsMultiSelectMode}
                      displayHeight={photo.displayHeight}
                      onCopySelected={onCopySelected}
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
