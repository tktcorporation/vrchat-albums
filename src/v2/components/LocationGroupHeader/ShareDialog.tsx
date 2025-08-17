import { trpcReact } from '@/trpc';
import { Copy, Download, LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '../../../components/ui/context-menu';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { Label } from '../../../components/ui/label';
import { Switch } from '../../../components/ui/switch';
import { ICON_SIZE } from '../../constants/ui';
import { useI18n } from '../../i18n/store';
import { generatePreviewPng } from '../../utils/previewGenerator';
import { downloadOrCopyImageAsPng } from '../../utils/shareUtils';

interface Player {
  id: string;
  playerId: string | null;
  playerName: string;
  joinDateTime: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface ShareDialogProps {
  isOpen: boolean;
  onClose: () => void;
  worldName: string | null;
  worldId: string;
  joinDateTime: Date;
  imageUrl: string | null;
  players: Player[] | null;
}

/**
 * ワールド情報と写真を共有するためのダイアログコンポーネント
 * プレビュー画像の生成、クリップボードへのコピー、ダウンロード機能を提供
 */
export const ShareDialog = ({
  isOpen,
  onClose,
  worldName,
  worldId,
  joinDateTime,
  imageUrl,
  players,
}: ShareDialogProps) => {
  const { t } = useI18n();
  const [showAllPlayers, setShowAllPlayers] = useState(false);
  const [previewBase64, setPreviewBase64] = useState<string | null>(null);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);

  // 画像のBase64変換をバックエンドに依頼
  const { data: base64Data, isLoading } =
    trpcReact.vrchatApi.convertImageToBase64.useQuery(imageUrl || '', {
      enabled: !!imageUrl && isOpen,
      staleTime: 1000 * 60 * 5, // 5分間キャッシュ
      cacheTime: 1000 * 60 * 30, // 30分間キャッシュを保持
    });

  const copyImageMutation =
    trpcReact.electronUtil.copyImageDataByBase64.useMutation();
  const downloadImageMutation =
    trpcReact.electronUtil.downloadImageAsPhotoLogPng.useMutation();

  // プレビュー画像を生成する関数
  /**
   * 共有用のプレビュー画像を生成して state に保存する。
   */
  const generatePreview = async () => {
    if (!base64Data || !worldName) return;
    setIsGeneratingPreview(true);
    try {
      const pngBase64 = await generatePreviewPng({
        worldName,
        imageBase64: base64Data,
        players,
        showAllPlayers,
      });
      setPreviewBase64(pngBase64);
    } catch (error) {
      console.error('Failed to generate preview:', error);
    } finally {
      setIsGeneratingPreview(false);
    }
  };

  // base64Dataが変更されたら、プレビューを生成
  useEffect(() => {
    if (base64Data) {
      generatePreview();
    }
  }, [base64Data, worldName, players, showAllPlayers]);

  /** 生成済みの画像をクリップボードへコピーする */
  const handleCopyShareImageToClipboard = async () => {
    if (!previewBase64) return;
    await downloadOrCopyImageAsPng({
      pngBase64: previewBase64,
      filenameWithoutExt: worldName || 'image',
      downloadOrCopyMutation: {
        mutateAsync: async (params) => {
          await copyImageMutation.mutateAsync(params);
          return undefined;
        },
      },
    });
  };

  /** 生成済みの画像をダウンロードする */
  const handleDownloadShareImagePng = async () => {
    if (!previewBase64) return;
    await downloadImageMutation.mutateAsync({
      worldId,
      joinDateTime,
      imageBase64: previewBase64,
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="h-[70vh] flex flex-col p-0 backdrop-blur-xl bg-white/80 dark:bg-gray-900/80 border border-white/20 dark:border-gray-700/30 shadow-2xl">
        <DialogHeader className="px-6 pt-4 pb-2 border-b border-white/10 dark:border-gray-700/20 flex flex-row items-center justify-between">
          <DialogTitle className="text-lg font-semibold text-gray-800 dark:text-white">
            {t('locationHeader.share')}
          </DialogTitle>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopyShareImageToClipboard}
              disabled={isLoading}
              className="p-2 rounded-lg bg-white/20 dark:bg-gray-800/50 hover:bg-white/30 dark:hover:bg-gray-800/60 border border-white/10 dark:border-gray-700/30 text-gray-700 dark:text-gray-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              title={t('locationHeader.copyToClipboard')}
            >
              <Copy className={ICON_SIZE.md.class} />
            </button>
            <button
              type="button"
              onClick={handleDownloadShareImagePng}
              disabled={isLoading}
              className="p-2 rounded-lg bg-white/20 dark:bg-gray-800/50 hover:bg-white/30 dark:hover:bg-gray-800/60 border border-white/10 dark:border-gray-700/30 text-gray-700 dark:text-gray-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              title={t('locationHeader.downloadImage')}
            >
              <Download className={ICON_SIZE.md.class} />
            </button>
          </div>
        </DialogHeader>
        <div className="flex flex-col pb-6 px-6 h-[calc(100vh-130px)] items-center justify-center">
          <div className="h-full aspect-[4/3] overflow-y-auto border border-white/10 dark:border-gray-700/20 rounded-lg">
            <ContextMenu>
              <ContextMenuTrigger className="w-full">
                <div className="h-full rounded-lg overflow-y-auto">
                  <div className="w-full">
                    {isLoading || isGeneratingPreview ? (
                      <div className="flex items-center justify-center">
                        <LoaderCircle
                          className={`${ICON_SIZE.lg.class} animate-spin text-primary`}
                        />
                      </div>
                    ) : (
                      <div className="flex items-center justify-center">
                        {previewBase64 && (
                          <img
                            src={`data:image/png;base64,${previewBase64}`}
                            alt={worldName || 'Preview'}
                            className="h-96	 max-h-full w-auto"
                          />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="bg-white/95 dark:bg-gray-900/95 backdrop-blur-md border border-white/20 dark:border-gray-700/30 shadow-lg">
                <ContextMenuItem
                  className="hover:bg-white/50 dark:hover:bg-gray-800/50 focus:bg-white/60 dark:focus:bg-gray-800/60 flex items-center gap-2"
                  onClick={handleCopyShareImageToClipboard}
                  disabled={isLoading}
                >
                  <Copy className={ICON_SIZE.sm.class} />
                  <span>{t('locationHeader.copyToClipboard')}</span>
                </ContextMenuItem>
                <ContextMenuItem
                  className="hover:bg-white/50 dark:hover:bg-gray-800/50 focus:bg-white/60 dark:focus:bg-gray-800/60 flex items-center gap-2"
                  onClick={handleDownloadShareImagePng}
                  disabled={isLoading}
                >
                  <Download className={ICON_SIZE.sm.class} />
                  <span>{t('locationHeader.downloadImage')}</span>
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          </div>
        </div>
        <DialogFooter className="px-6 py-4 border-t border-white/10 dark:border-gray-700/20">
          <div className="flex items-center space-x-2">
            <Switch
              id="show-all-players"
              className="data-[state=checked]:bg-primary-500/90 data-[state=unchecked]:bg-white/20 dark:data-[state=unchecked]:bg-gray-800/50"
              checked={showAllPlayers}
              onCheckedChange={setShowAllPlayers}
            />
            <Label
              htmlFor="show-all-players"
              className="text-sm text-gray-800 dark:text-gray-200 cursor-pointer"
            >
              {t('locationHeader.showAllPlayers')}
            </Label>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
