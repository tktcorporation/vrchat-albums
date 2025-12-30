import { useMemo } from 'react';
import type { Photo } from '../types/photo';
import { JustifiedLayoutCalculator } from '../utils/justifiedLayoutCalculator';
import { LocationGroupHeader } from './LocationGroupHeader';

/**
 * GroupWithSkeleton コンポーネントのプロパティ定義
 */
interface GroupWithSkeletonProps {
  /** グループ内の写真配列（PhotoMetadataOnly でも可） */
  photos: Photo[];
  /**
   * レイアウト計算に使用する幅（px）
   * 親コンポーネント（GalleryContent）から明示的に渡される
   */
  effectiveWidth: number;
  /** ワールドID */
  worldId: string | null;
  /** ワールド名 */
  worldName: string | null;
  /** ワールドインスタンスID */
  worldInstanceId: string | null;
  /** 写真数 */
  photoCount: number;
  /** ワールド参加日時 */
  joinDateTime: Date;
}

/**
 * Immich方式のスケルトンコンポーネント
 *
 * ## 設計原則
 *
 * JustifiedLayoutCalculator を使用して、実際の写真と**同じ高さ**で
 * スケルトンボックスを配置する。これにより、スケルトン→実コンテンツの
 * 切り替え時にレイアウトシフトが発生しない。
 *
 * ## Immich との比較
 *
 * - Immich: `monthGroup.height` をスケルトンと実コンテンツで共有
 * - VRChat Albums: `JustifiedLayoutCalculator.calculateLayout()` の結果を共有
 *
 * ## PhotoMetadataOnly の活用
 *
 * Photo 型は `PhotoMetadataOnly | PhotoFullyLoaded` のユニオン型。
 * PhotoMetadataOnly にも `width`, `height` が含まれているため、
 * 画像ロード前でも正確なレイアウト計算が可能。
 *
 * @see JustifiedLayoutCalculator - レイアウト計算
 * @see PhotoGrid - 実際の写真表示（同じレイアウト計算を使用）
 */
export function GroupWithSkeleton({
  photos,
  effectiveWidth,
  worldId,
  worldName,
  worldInstanceId,
  photoCount,
  joinDateTime,
}: GroupWithSkeletonProps) {
  const calculator = useMemo(() => new JustifiedLayoutCalculator(), []);

  // PhotoGrid と同じレイアウト計算を使用（同じ effectiveWidth を使用）
  const layout = useMemo(() => {
    if (effectiveWidth === 0 || photos.length === 0) {
      return { rows: [], totalHeight: 0 };
    }
    return calculator.calculateLayout(photos, effectiveWidth);
  }, [calculator, photos, effectiveWidth]);

  return (
    <div className="w-full space-y-0">
      {/* 実際のヘッダー（スケルトンではない） */}
      <LocationGroupHeader
        worldId={worldId}
        worldName={worldName}
        worldInstanceId={worldInstanceId}
        photoCount={photoCount}
        joinDateTime={joinDateTime}
      />

      {/* JustifiedLayout で計算された位置にスケルトンボックスを配置 */}
      {photos.length > 0 && (
        <div className="w-full rounded-b-lg overflow-hidden">
          <div className="space-y-1">
            {layout.rows.map((row, rowIndex) => {
              const rowKey = `skeleton-row-${rowIndex}-${row[0]?.id ?? rowIndex}`;
              return (
                <div
                  key={rowKey}
                  className="flex gap-1"
                  style={{
                    height: row[0]?.displayHeight ?? 200,
                  }}
                >
                  {row.map((photo, index) => {
                    const photoKey = `skeleton-${rowIndex}-${photo.id}-${index}`;
                    return (
                      <div
                        key={photoKey}
                        style={{
                          width: photo.displayWidth,
                          flexShrink: 0,
                        }}
                        className="bg-gray-200 dark:bg-gray-700 rounded animate-pulse"
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
