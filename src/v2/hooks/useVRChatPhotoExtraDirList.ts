import { trpcReact } from '@/trpc';

/**
 * PathSettings 画面で追加の写真フォルダを管理するためのフック。
 * tRPC を用いて設定を取得・保存する。
 */
export const useVRChatPhotoExtraDirList = (): [
  string[],
  (dirs: string[]) => void,
] => {
  const { data: extraDirs = [], refetch } =
    trpcReact.getVRChatPhotoExtraDirList.useQuery();
  const { mutate } = trpcReact.setVRChatPhotoExtraDirList.useMutation({
    onSuccess: () => {
      void refetch();
    },
  });

  return [extraDirs, mutate];
};
