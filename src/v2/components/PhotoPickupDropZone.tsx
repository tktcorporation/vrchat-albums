import clsx from 'clsx';
import { Flag } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { ICON_SIZE } from '../constants/ui';
import { useI18n } from '../i18n/store';

interface PhotoPickupDropZoneProps {
  pickupCount: number;
  onDrop: (photoId: string) => void;
}

/**
 * ドラッグ中のみ画面下部に出現するドロップゾーン。
 *
 * 背景: 写真をドラッグしてピックアップに追加する操作の受け皿。
 * ドラッグしていないときはUIに一切表示されない（引き算のデザイン）。
 *
 * @see docs/plans/2026-03-09-photo-pickup-design.md
 */
const PhotoPickupDropZone = memo(
  ({ pickupCount, onDrop }: PhotoPickupDropZoneProps) => {
    const { t } = useI18n();
    const [isDragging, setIsDragging] = useState(false);
    const [isDragOver, setIsDragOver] = useState(false);

    // window レベルで dragenter/dragleave を監視してドラッグ中かを判定
    useEffect(() => {
      let dragCounter = 0;

      const handleDragEnter = (e: DragEvent) => {
        // テキストデータを持つドラッグのみ反応（ファイルドラッグは無視）
        if (e.dataTransfer?.types.includes('text/plain')) {
          dragCounter++;
          if (dragCounter === 1) {
            setIsDragging(true);
          }
        }
      };

      const handleDragLeave = () => {
        dragCounter--;
        if (dragCounter <= 0) {
          dragCounter = 0;
          setIsDragging(false);
          setIsDragOver(false);
        }
      };

      const handleDragEnd = () => {
        dragCounter = 0;
        setIsDragging(false);
        setIsDragOver(false);
      };

      const handleDrop = () => {
        dragCounter = 0;
        setIsDragging(false);
        setIsDragOver(false);
      };

      window.addEventListener('dragenter', handleDragEnter);
      window.addEventListener('dragleave', handleDragLeave);
      window.addEventListener('dragend', handleDragEnd);
      window.addEventListener('drop', handleDrop);

      return () => {
        window.removeEventListener('dragenter', handleDragEnter);
        window.removeEventListener('dragleave', handleDragLeave);
        window.removeEventListener('dragend', handleDragEnd);
        window.removeEventListener('drop', handleDrop);
      };
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsDragOver(true);
    }, []);

    const handleDragLeaveZone = useCallback(() => {
      setIsDragOver(false);
    }, []);

    const handleDrop = useCallback(
      (e: React.DragEvent) => {
        e.preventDefault();
        const photoId = e.dataTransfer.getData('text/plain');
        if (photoId) {
          onDrop(photoId);
        }
        setIsDragOver(false);
      },
      [onDrop],
    );

    return (
      <div
        className={clsx(
          'fixed bottom-0 left-0 right-0 z-50 flex items-center justify-center gap-2',
          'h-16 border-t border-border/50',
          'transition-all duration-200 ease-out',
          isDragging
            ? 'translate-y-0 opacity-100'
            : 'translate-y-full opacity-0 pointer-events-none',
          isDragOver
            ? 'bg-primary/20 border-primary/30'
            : 'bg-background/95 backdrop-blur-sm',
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeaveZone}
        onDrop={handleDrop}
      >
        <Flag size={ICON_SIZE.sm.pixels} className="text-muted-foreground" />
        <span className="text-sm text-muted-foreground">
          {t('pickup.dropZoneLabel')}
          {pickupCount > 0 && (
            <span className="ml-2 text-xs text-muted-foreground/70">
              ({t('pickup.photoCount').replace('{count}', String(pickupCount))})
            </span>
          )}
        </span>
      </div>
    );
  },
);

PhotoPickupDropZone.displayName = 'PhotoPickupDropZone';

export default PhotoPickupDropZone;
