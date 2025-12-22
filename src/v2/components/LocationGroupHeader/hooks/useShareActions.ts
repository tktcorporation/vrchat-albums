import { useState } from 'react';
import { trpcReact } from '@/trpc';

/**
 * シェアダイアログの状態とアクションを管理するカスタムフック
 */
export const useShareActions = () => {
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);

  const openUrlMutation =
    trpcReact.electronUtil.openUrlInDefaultBrowser.useMutation();

  const copyTextMutation =
    trpcReact.electronUtil.copyTextToClipboard.useMutation();

  /** シェアダイアログを開く */
  const openShareModal = () => setIsShareModalOpen(true);
  /** シェアダイアログを閉じる */
  const closeShareModal = () => setIsShareModalOpen(false);

  /** ブラウザでワールドリンクを開く */
  const openWorldLink = (worldLink: string) => {
    openUrlMutation.mutate(worldLink);
  };

  /** プレイヤー名一覧をクリップボードにコピーする */
  const copyPlayersToClipboard = async (playerNames: string[]) => {
    const text = playerNames.join('\n');
    await copyTextMutation.mutateAsync(text);
  };

  return {
    isShareModalOpen,
    openShareModal,
    closeShareModal,
    openWorldLink,
    copyPlayersToClipboard,
  };
};
