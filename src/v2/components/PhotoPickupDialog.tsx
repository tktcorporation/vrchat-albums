import clsx from 'clsx';
import { Flag, Trash2, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { trpcReact } from '@/trpc';
import { ICON_SIZE } from '../constants/ui';
import { useThumbnail } from '../hooks/useThumbnailCache';
import { useI18n } from '../i18n/store';

interface PhotoPickupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pickupList: Array<{ photoId: string; createdAt: Date }>;
  onRemove: (photoId: string) => void;
  onClearAll: () => void;
  onRefetch: () => void;
}

/**
 * ピックアップ一覧を表示するダイアログ。
 *
 * 背景: ピックした写真を見返し、コピー・削除・クリアを行う。
 * 既存の Dialog コンポーネントパターンを踏襲。
 *
 * @see docs/plans/2026-03-09-photo-pickup-design.md
 */
const PhotoPickupDialog = memo(
  ({
    open,
    onOpenChange,
    pickupList,
    onRemove,
    onClearAll,
    onRefetch,
  }: PhotoPickupDialogProps) => {
    const { t } = useI18n();

    const copyMultipleMutation =
      trpcReact.electronUtil.copyMultipleImagePaths.useMutation();

    // ダイアログを開いたときにリストを取得
    useEffect(() => {
      if (open) {
        onRefetch();
      }
    }, [open, onRefetch]);

    // 全写真のパスをバッチ取得
    const photoIds = useMemo(() => pickupList.map((p) => p.photoId), [pickupList]);
    const { data: photoPathEntries } =
      trpcReact.vrchatPhoto.getVrchatPhotoPathsByIds.useQuery(
        { ids: photoIds },
        { enabled: open && photoIds.length > 0 },
      );

    // 配列形式の結果を Record<photoId, photoPath> に変換
    const photoPathMap = useMemo(() => {
      if (!photoPathEntries) return undefined;
      return Object.fromEntries(
        photoPathEntries.map(({ id, photoPath }) => [id, photoPath]),
      );
    }, [photoPathEntries]);

    const handleCopyAll = useCallback(() => {
      if (!photoPathMap) return;
      const paths = pickupList
        .map((p) => photoPathMap[p.photoId])
        .filter((path): path is string => !!path);
      if (paths.length > 0) {
        copyMultipleMutation.mutate(paths);
      }
    }, [pickupList, photoPathMap, copyMultipleMutation]);

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Flag size={ICON_SIZE.sm.pixels} />
              {t('pickup.dialogTitle')}
              {pickupList.length > 0 && (
                <span className="text-sm font-normal text-muted-foreground">
                  (
                  {t('pickup.photoCount').replace(
                    '{count}',
                    String(pickupList.length),
                  )}
                  )
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto min-h-0">
            {pickupList.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <p className="text-sm text-muted-foreground">
                  {t('pickup.emptyMessage')}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 p-1">
                {pickupList.map((pickup) => (
                  <PickupThumbnail
                    key={pickup.photoId}
                    photoId={pickup.photoId}
                    photoPath={photoPathMap?.[pickup.photoId]}
                    onRemove={onRemove}
                  />
                ))}
              </div>
            )}
          </div>

          {pickupList.length > 0 && (
            <DialogFooter className="flex justify-between sm:justify-between">
              <Button
                variant="ghost"
                size="sm"
                onClick={onClearAll}
                className="text-muted-foreground"
              >
                <Trash2 className={ICON_SIZE.sm.class} />
                {t('pickup.clearAll')}
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={handleCopyAll}
                disabled={!photoPathMap}
              >
                {t('pickup.copyAll')}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    );
  },
);

PhotoPickupDialog.displayName = 'PhotoPickupDialog';

/**
 * ピックアップ内の個別サムネイル表示。
 * ホバー時に「外す」ボタンを表示。
 */
const PickupThumbnail = memo(
  ({
    photoId,
    photoPath,
    onRemove,
  }: {
    photoId: string;
    photoPath?: string;
    onRemove: (photoId: string) => void;
  }) => {
    const thumbnail = useThumbnail(photoPath ?? '', !!photoPath);

    return (
      <div className="relative group aspect-square bg-muted rounded overflow-hidden">
        {thumbnail ? (
          <img
            src={thumbnail}
            alt=""
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full animate-pulse bg-muted" />
        )}
        {/* ホバー時に「外す」ボタン表示 */}
        <button
          type="button"
          className={clsx(
            'absolute top-1 right-1 p-1 rounded-full',
            'bg-background/80 backdrop-blur-sm',
            'opacity-0 group-hover:opacity-100 transition-opacity duration-150',
            'hover:bg-destructive/20',
          )}
          onClick={() => onRemove(photoId)}
        >
          <X size={ICON_SIZE.xs.pixels} className="text-foreground" />
        </button>
      </div>
    );
  },
);

PickupThumbnail.displayName = 'PickupThumbnail';

export default PhotoPickupDialog;
