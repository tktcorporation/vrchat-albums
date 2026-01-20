import type { trpcReact } from '@/trpc';

/**
 * ログ更新に関連するすべての tRPC クエリを再取得させるためのユーティリティ関数。
 * ログが更新されると、写真のグルーピング、ワールド参加情報、プレイヤー情報などが
 * 変更される可能性があるため、関連するすべてのクエリを無効化する。
 */
export const invalidatePhotoGalleryQueries = async (
  trpsUtils: ReturnType<typeof trpcReact.useUtils>,
): Promise<void> => {
  await Promise.all([
    // 写真関連のクエリ
    trpsUtils.vrchatPhoto.getVrchatPhotoPathModelList.invalidate(),
    // ワールド参加ログ関連のクエリ
    trpsUtils.vrchatWorldJoinLog.getVRChatWorldJoinLogList.invalidate(),
  ]);

  // ログ情報関連のクエリ（パフォーマンスを考慮して必要に応じて）
  // trpsUtils.logInfo.invalidate();

  console.log('Invalidated all photo gallery related queries');
};
