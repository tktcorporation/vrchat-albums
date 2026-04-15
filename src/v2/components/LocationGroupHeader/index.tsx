import { format } from 'date-fns';
import {
  Calendar,
  CheckIcon,
  Copy,
  ExternalLink,
  ImageIcon,
  Share2,
  Users,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { trpcReact } from '@/trpc';

import { ICON_SIZE, TEXT_COLOR } from '../../constants/ui';
import { useI18n } from '../../i18n/store';
import {
  getInstanceTypeColor,
  getInstanceTypeLabel,
  shouldShowInstanceTypeBadge,
} from '../../utils/instanceTypeUtils';
import { usePlayerListDisplay } from './hooks/usePlayerListDisplay';
import { useQueryQueue } from './hooks/useQueryQueue';
import { useSessionInfoBatch } from './hooks/useSessionInfoBatch';
import { useShareActions } from './hooks/useShareActions';
import { PlatformBadge } from './PlatformBadge';
import { type Player, PlayerList } from './PlayerList';
import { ShareDialog } from './ShareDialog';

/**
 * LocationGroupHeaderのプロパティ定義
 * @param worldId - ワールドのID
 * @param worldName - ワールドの名前
 * @param worldInstanceId - ワールドインスタンスのID
 * @param photoCount - 写真の枚数
 * @param joinDateTime - ワールドに参加した日時
 */
interface LocationGroupHeaderProps {
  worldId: string | null;
  worldName: string | null;
  worldInstanceId: string | null;
  photoCount: number;
  joinDateTime: Date;
}

/**
 * 写真グループのヘッダー部分を表示するコンポーネント。
 * 共有ボタンやプレイヤー一覧モーダルなどを管理する。
 */
export const LocationGroupHeader = ({
  worldId,
  worldName,
  worldInstanceId,
  photoCount: _photoCount,
  joinDateTime,
}: LocationGroupHeaderProps) => {
  const { t } = useI18n();
  const {
    isShareModalOpen,
    openShareModal,
    closeShareModal,
    openWorldLink,
    copyPlayersToClipboard,
  } = useShareActions();

  // State
  const [_isImageLoaded, _setIsImageLoaded] = useState(false);
  const [shouldLoadDetails, setShouldLoadDetails] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const visibilityTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Query queueing to prevent too many simultaneous requests
  // Priority based on scroll position - elements higher up get higher priority
  const queryPriority = Math.max(
    0,
    10 - Math.floor((containerRef.current?.offsetTop ?? 0) / 500),
  );
  const canExecuteQuery = useQueryQueue(
    isVisible && shouldLoadDetails,
    queryPriority,
    20,
  );

  // Query enablement state for cancellation control
  const [queryEnabled, setQueryEnabled] = useState(false);

  // VRChat API からワールドの詳細情報を取得（サムネイルなど）
  const { data: details } =
    trpcReact.vrchatApi.getVrcWorldInfoByWorldId.useQuery(worldId ?? '', {
      enabled: worldId !== null && worldId !== '' && canExecuteQuery,
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 30,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    });

  // プレイヤー情報のみバッチ取得で効率化（500msのウィンドウ）
  const { players: playersResult, isLoading: isPlayersLoading } =
    useSessionInfoBatch(joinDateTime, canExecuteQuery && queryEnabled);

  // Derived state
  const formattedDate = format(joinDateTime, 'yyyy年MM月dd日 HH:mm');
  // プレイヤーリストの重複を除去（rejoinしたプレイヤーが複数回表示されるのを防ぐ）
  const players = Array.isArray(playersResult)
    ? playersResult.filter(
        (player, index, arr) =>
          arr.findIndex((p) => p.playerName === player.playerName) === index,
      )
    : null;

  // プレイヤーリスト表示のカスタムフック
  const {
    maxVisiblePlayers,
    isHovered,
    setIsHovered,
    tooltipPosition,
    isCopied,
    playerListContainerRef,
    handleMouseMove,
    handleCopyPlayers: handleCopyPlayersUI,
  } = usePlayerListDisplay(players);

  // Event handlers
  /** プレイヤー名一覧をクリップボードへコピーする */
  const handleCopyPlayers = async () => {
    if (!players) {
      return;
    }
    const playerNames = players.map((p) => p.playerName);
    await copyPlayersToClipboard(playerNames);
    handleCopyPlayersUI();
  };

  // Effects
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            // Clear any existing timeout
            if (visibilityTimeoutRef.current) {
              clearTimeout(visibilityTimeoutRef.current);
            }
            // Set visible immediately for UI updates
            setIsVisible(true);
            // 適度なデバウンス時間でクエリ実行を制限
            visibilityTimeoutRef.current = setTimeout(() => {
              setShouldLoadDetails(true);
              setQueryEnabled(true);
            }, 20); // 最小限のデバウンスで最高速レスポンス
          } else {
            // Clear timeout if element becomes invisible before timeout
            if (visibilityTimeoutRef.current) {
              clearTimeout(visibilityTimeoutRef.current);
            }
            setIsVisible(false);
            // Disable queries immediately when leaving viewport
            setQueryEnabled(false);
            // Add longer delay before disabling details loading to allow for smooth scrolling
            // This prevents queries from being cancelled and restarted rapidly
            visibilityTimeoutRef.current = setTimeout(() => {
              setShouldLoadDetails(false);
            }, 300); // バランスの取れた遅延でちらつき防止
          }
        }
      },
      {
        root: null, // Use viewport as root
        rootMargin: '200px', // 早期読み込みのための拡張マージン
        threshold: 0.1, // 10%表示で反応
      },
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => {
      observer.disconnect();
      if (visibilityTimeoutRef.current) {
        clearTimeout(visibilityTimeoutRef.current);
      }
    };
  }, []);

  // Reset query enabled state when component unmounts or becomes invisible
  useEffect(() => {
    if (!isVisible) {
      setQueryEnabled(false);
    }
  }, [isVisible]);

  // ワールドリンク
  const worldLink = worldInstanceId
    ? `https://vrchat.com/home/launch?worldId=${worldId}&instanceId=${worldInstanceId}`
    : `https://vrchat.com/home/world/${worldId}/info`;

  if (worldId === null) {
    return (
      <header data-testid="location-group-header" className="w-full px-5 py-4">
        <h2 className={`text-lg font-semibold ${TEXT_COLOR.primary}`}>
          {t('locationHeader.ungrouped')}
        </h2>
        <div
          className={`mt-1.5 text-xs ${TEXT_COLOR.secondary} flex items-center gap-1.5`}
        >
          <Calendar className={ICON_SIZE.xs.class} />
          <time dateTime={joinDateTime.toISOString()}>{formattedDate}</time>
        </div>
      </header>
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid="location-group-header"
      className="w-full group/card rounded-xl overflow-hidden"
    >
      <div className="relative overflow-hidden flex items-center px-6 py-5">
        {/* 背景ブラー — ワールドの雰囲気を余韻として感じさせる */}
        {details?.thumbnailImageUrl && isVisible && (
          <div
            className="absolute inset-0 scale-110 opacity-[0.06] dark:opacity-[0.1]"
            style={{
              backgroundImage: `url(${details.thumbnailImageUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: 'blur(40px) saturate(150%)',
            }}
          />
        )}

        <div className="relative flex items-center gap-4 w-full">
          {/* 左側 - ワールド画像（ボーダーなし、丸く、影で浮遊感） */}
          <div className="flex-shrink-0">
            {details?.thumbnailImageUrl ? (
              <div
                className="h-14 rounded-lg overflow-hidden shadow-subtle transition-shadow duration-250 ease-spring group-hover/card:shadow-float"
                style={{ aspectRatio: '16/10' }}
              >
                <img
                  src={details.thumbnailImageUrl}
                  alt={(details?.name || worldName) ?? 'World'}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>
            ) : (
              <div
                className="h-14 rounded-lg bg-muted/40 flex items-center justify-center"
                style={{ aspectRatio: '16/10' }}
              >
                <ImageIcon
                  className={`${ICON_SIZE.lg.class} text-muted-foreground/20`}
                />
              </div>
            )}
          </div>

          {/* 右側 - 情報 — 余白でグルーピング */}
          <div className="flex-1 min-w-0 flex flex-col gap-2">
            {/* 1行目: ワールド名とアクション */}
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold flex items-center group/title text-foreground">
                <button
                  type="button"
                  className="flex items-center transition-all duration-200 ease-spring hover:text-primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    openWorldLink(worldLink);
                  }}
                >
                  <span className="line-clamp-1 text-start">
                    {details?.name ?? worldName}
                  </span>
                  <ExternalLink
                    className={`${ICON_SIZE.xs.class} ml-1.5 opacity-0 group-hover/title:opacity-60 transition-opacity duration-200 flex-shrink-0`}
                  />
                </button>
              </h3>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {worldInstanceId &&
                  shouldShowInstanceTypeBadge(worldInstanceId) && (
                    <div
                      className={`flex items-center text-[11px] font-medium px-2 py-0.5 rounded-lg transition-colors duration-200 ${getInstanceTypeColor(
                        worldInstanceId,
                      )}`}
                    >
                      {getInstanceTypeLabel(worldInstanceId)}
                    </div>
                  )}
                {details?.unityPackages && details.unityPackages.length > 0 && (
                  <div className="flex items-center gap-1">
                    {[
                      ...new Set(
                        details.unityPackages.map((pkg) => pkg.platform),
                      ),
                    ].map((platform) => (
                      <PlatformBadge key={platform} platform={platform} />
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={openShareModal}
                  className="flex items-center text-sm text-muted-foreground/50 hover:text-foreground p-1.5 rounded-lg hover:bg-muted/40 transition-all duration-200 ease-spring"
                >
                  <Share2 className={ICON_SIZE.sm.class} />
                </button>
              </div>
            </div>

            {/* 2行目: 日付 + プレイヤー — ボーダーなし、テキストだけで情報を伝える */}
            <div className="flex items-center gap-3 w-full text-xs text-muted-foreground">
              <span className="flex items-center gap-1 flex-shrink-0">
                <Calendar className={ICON_SIZE.xs.class} />
                {formattedDate}
              </span>
              <span className="text-muted-foreground/20">·</span>
              {(() => {
                if (isPlayersLoading || players === null) {
                  return (
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Users
                        className={`${ICON_SIZE.xs.class} text-muted-foreground/40 flex-shrink-0`}
                      />
                      <div className="h-3 w-6 bg-muted/40 rounded-full animate-pulse" />
                      <div className="h-3 w-20 bg-muted/40 rounded-full animate-pulse" />
                    </div>
                  );
                }
                if (players.length > 0) {
                  return (
                    <div className="flex items-center gap-1.5 group/players flex-1 min-w-0">
                      <Users
                        className={`${ICON_SIZE.xs.class} text-muted-foreground/40 flex-shrink-0`}
                      />
                      <span className="text-muted-foreground/60">
                        {players.length}
                      </span>
                      <button
                        type="button"
                        ref={playerListContainerRef}
                        className="relative cursor-pointer flex-1 min-w-0 appearance-none border-none bg-transparent p-0 text-left"
                        onMouseEnter={() => setIsHovered(true)}
                        onMouseLeave={() => setIsHovered(false)}
                        onMouseMove={handleMouseMove}
                        onClick={() => void handleCopyPlayers()}
                        title={t('locationHeader.clickToCopy')}
                      >
                        <div className="flex items-center gap-1.5 w-full">
                          {isCopied ? (
                            <span className="text-success flex items-center gap-1">
                              <CheckIcon className={ICON_SIZE.xs.class} />
                              {t('locationHeader.copied')}
                            </span>
                          ) : (
                            <PlayerList
                              players={players}
                              maxVisiblePlayers={maxVisiblePlayers}
                            />
                          )}
                        </div>
                        {players &&
                          createPortal(
                            <div
                              style={{
                                position: 'fixed',
                                visibility: isHovered ? 'visible' : 'hidden',
                                opacity: isHovered ? 1 : 0,
                                transition:
                                  'opacity 200ms cubic-bezier(0.22, 1, 0.36, 1)',
                                top: tooltipPosition.top,
                                left: tooltipPosition.left,
                              }}
                              className="z-50 p-3 bg-popover/95 backdrop-blur-xl text-foreground text-sm rounded-xl shadow-elevated"
                            >
                              <div className="flex flex-wrap gap-1.5">
                                {players.map((p: Player) => (
                                  <span
                                    key={p.id}
                                    className="bg-muted/60 text-muted-foreground px-2.5 py-0.5 rounded-lg text-xs"
                                  >
                                    {p.playerName}
                                  </span>
                                ))}
                              </div>
                            </div>,
                            document.body,
                          )}
                      </button>
                      <Copy
                        className={`${ICON_SIZE.xs.class} ml-1 text-muted-foreground/30 group-hover/players:text-muted-foreground transition-colors duration-200 flex-shrink-0`}
                      />
                    </div>
                  );
                }
                return (
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <Users
                      className={`${ICON_SIZE.xs.class} text-muted-foreground/40 flex-shrink-0`}
                    />
                    <span className="text-muted-foreground/40">
                      {t('locationHeader.noPlayerInfo')}
                    </span>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      </div>
      <ShareDialog
        isOpen={isShareModalOpen}
        onClose={closeShareModal}
        worldName={details?.name ?? worldName}
        worldId={worldId}
        joinDateTime={joinDateTime}
        imageUrl={details?.imageUrl ?? null}
        players={players}
      />
    </div>
  );
};
