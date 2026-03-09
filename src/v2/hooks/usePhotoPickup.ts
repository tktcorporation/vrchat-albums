import { useCallback, useMemo } from 'react';
import { trpcReact } from '@/trpc';

/**
 * 写真ピックアップの状態管理と操作を提供する hook。
 *
 * 背景: SNS投稿用に写真を一時的にストックする機能のフロントエンド状態管理。
 * React Query でキャッシュし、ミューテーション後に自動で再取得する。
 *
 * @see docs/plans/2026-03-09-photo-pickup-design.md
 */
export function usePhotoPickup() {
  const utils = trpcReact.useUtils();

  const { data: pickupPhotoIds = [] } =
    trpcReact.photoPickup.photoIdSet.useQuery();

  const pickupSet = useMemo(
    () => new Set(pickupPhotoIds),
    [pickupPhotoIds],
  );

  const {
    data: pickupList = [],
    refetch: refetchList,
  } = trpcReact.photoPickup.list.useQuery(undefined, {
    enabled: false,
  });

  const addMutation = trpcReact.photoPickup.add.useMutation({
    onSuccess: () => {
      utils.photoPickup.photoIdSet.invalidate();
      utils.photoPickup.list.invalidate();
    },
  });

  const removeMutation = trpcReact.photoPickup.remove.useMutation({
    onSuccess: () => {
      utils.photoPickup.photoIdSet.invalidate();
      utils.photoPickup.list.invalidate();
    },
  });

  const removeAllMutation = trpcReact.photoPickup.removeAll.useMutation({
    onSuccess: () => {
      utils.photoPickup.photoIdSet.invalidate();
      utils.photoPickup.list.invalidate();
    },
  });

  const addPickup = useCallback(
    (photoId: string) => addMutation.mutate({ photoId }),
    [addMutation],
  );

  const removePickup = useCallback(
    (photoId: string) => removeMutation.mutate({ photoId }),
    [removeMutation],
  );

  const togglePickup = useCallback(
    (photoId: string) => {
      if (pickupSet.has(photoId)) {
        removePickup(photoId);
      } else {
        addPickup(photoId);
      }
    },
    [pickupSet, addPickup, removePickup],
  );

  const clearAll = useCallback(
    () => removeAllMutation.mutate(),
    [removeAllMutation],
  );

  const isPickedUp = useCallback(
    (photoId: string) => pickupSet.has(photoId),
    [pickupSet],
  );

  return {
    pickupCount: pickupPhotoIds.length,
    pickupList,
    refetchList,
    addPickup,
    removePickup,
    togglePickup,
    clearAll,
    isPickedUp,
  };
}
