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
import type { ReactPortal } from 'react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Badge } from '@/components/ui/badge';
import { trpcReact } from '@/trpc';
import { ICON_SIZE, SPACING, TEXT_COLOR } from '../../constants/ui';
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
  const visibilityTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // Query queueing to prevent too many simultaneous requests
  // Priority based on scroll position - elements higher up get higher priority
  const queryPriority = Math.max(
    0,
    10 - Math.floor((containerRef.current?.offsetTop || 0) / 500),
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
    if (!players) return;
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
      <header
        data-testid="location-group-header"
        className={`w-full glass-panel rounded-t-xl ${SPACING.padding.section}`}
      >
        <div className={`flex items-center ${SPACING.inline.relaxed}`}>
          <h2 className={`text-xl font-bold ${TEXT_COLOR.primary}`}>
            {t('locationHeader.ungrouped')}
          </h2>
        </div>
        <div
          className={`mt-2 text-sm ${TEXT_COLOR.secondary} flex items-center ${SPACING.inline.default}`}
        >
          <Calendar className={ICON_SIZE.sm.class} />
          <time dateTime={joinDateTime.toISOString()}>{formattedDate}</time>
        </div>
      </header>
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid="location-group-header"
      className="w-full glass-panel rounded-t-lg overflow-hidden group/card"
    >
      <div className="relative h-24 overflow-hidden flex items-center justify-center">
        <div className="absolute inset-0 bg-gradient-to-br from-muted to-muted/80 dark:from-muted dark:to-muted/60">
          {details?.thumbnailImageUrl && isVisible && (
            <>
              <div
                className="absolute inset-0 scale-110 transition-transform duration-700"
                style={{
                  backgroundImage: `url(${details.thumbnailImageUrl})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  filter: 'blur(26px) saturate(120%) brightness(0.9)',
                }}
              />
              <div className="absolute inset-0 bg-background/70 dark:bg-background/50 backdrop-blur-[1px] group-hover/card:backdrop-blur-[2px] transition-all duration-500" />
              <div className="absolute inset-0">
                <div className="absolute inset-0 bg-gradient-to-r from-background/60 to-background/40 dark:from-background/30 dark:to-background/10 mix-blend-overlay" />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,hsl(var(--background)/0.6),hsl(var(--background)/0.3)_70%)]" />
              </div>
            </>
          )}
        </div>

        <div className="absolute inset-0 flex items-center justify-center p-2">
          {/* 左側に画像、右側に情報 */}
          <div className="flex items-center gap-4 w-full">
            {/* 左側 - ワールド画像 */}
            <div className="flex-shrink-0">
              {details?.thumbnailImageUrl ? (
                <div
                  className="h-20 rounded-lg overflow-hidden border border-border/20 shadow-md"
                  style={{ aspectRatio: '4/3' }}
                >
                  <img
                    src={details.thumbnailImageUrl}
                    alt={details?.name || worldName || 'World'}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>
              ) : (
                <div
                  className="h-20 rounded-lg bg-muted flex items-center justify-center border border-border/20"
                  style={{ aspectRatio: '4/3' }}
                >
                  <ImageIcon
                    className={`${ICON_SIZE.lg.class} text-muted-foreground`}
                  />
                </div>
              )}
            </div>

            {/* 右側 - 情報 */}
            <div className="flex-1 min-w-0 flex flex-col gap-2">
              {/* 1行目: ワールド名とアクション */}
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold flex items-center group/title text-foreground">
                  <button
                    type="button"
                    className="hover:underline flex items-center transition-all duration-300 hover:text-primary-600 dark:hover:text-primary-300"
                    onClick={(e) => {
                      e.stopPropagation();
                      openWorldLink(worldLink);
                    }}
                  >
                    <span className="line-clamp-1 text-start">
                      {details?.name || worldName}
                    </span>
                    <ExternalLink
                      className={`${ICON_SIZE.sm.class} ml-2 transition-opacity flex-shrink-0`}
                    />
                  </button>
                </h3>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {worldInstanceId &&
                    shouldShowInstanceTypeBadge(worldInstanceId) && (
                      <div
                        className={`flex items-center text-xs font-medium px-2.5 py-1 rounded-full backdrop-blur-sm border transition-all duration-300 ${getInstanceTypeColor(
                          worldInstanceId,
                        )}`}
                      >
                        {getInstanceTypeLabel(worldInstanceId)}
                      </div>
                    )}
                  <Badge variant="glass" className="flex items-center text-sm">
                    <Calendar
                      className={`${ICON_SIZE.sm.class} mr-1.5 ${TEXT_COLOR.accent}`}
                    />
                    {formattedDate}
                  </Badge>
                  {details?.unityPackages &&
                    details.unityPackages.length > 0 && (
                      <div className="flex items-center gap-1.5">
                        {Array.from(
                          new Set(
                            details.unityPackages.map((pkg) => pkg.platform),
                          ),
                        ).map((platform) => (
                          <PlatformBadge key={platform} platform={platform} />
                        ))}
                      </div>
                    )}
                  <button
                    type="button"
                    onClick={openShareModal}
                    className="flex items-center text-sm font-medium text-foreground backdrop-blur-sm bg-primary/10 hover:bg-primary/20 px-3 py-1 rounded-full transition-all duration-300 border border-border/20 hover:border-border/30"
                  >
                    <Share2 className={`${ICON_SIZE.sm.class} mr-1.5`} />
                  </button>
                </div>
              </div>

              {/* 2行目: プレイヤーリスト */}
              <div className="flex items-center gap-2 w-full">
                {isPlayersLoading || players === null ? (
                  // ローディング中 or 未取得: スケルトン表示
                  <div className="flex gap-2 items-center text-xs text-foreground backdrop-blur-sm bg-background/30 px-3 py-1 rounded-full border border-border/20 flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <Users
                        className={`${ICON_SIZE.sm.class} text-primary flex-shrink-0`}
                      />
                      <div className="h-4 w-6 bg-muted-foreground/20 rounded animate-pulse" />
                    </div>
                    <div className="text-muted-foreground">|</div>
                    <div className="flex-1 flex items-center gap-2">
                      <div className="h-4 w-24 bg-muted-foreground/20 rounded animate-pulse" />
                      <div className="h-4 w-20 bg-muted-foreground/20 rounded animate-pulse" />
                      <div className="h-4 w-16 bg-muted-foreground/20 rounded animate-pulse" />
                    </div>
                  </div>
                ) : players.length > 0 ? (
                  // プレイヤーあり（取得済み、データあり）: リスト表示
                  <div className="flex gap-2 items-center text-xs text-foreground backdrop-blur-sm bg-background/30 hover:bg-background/40 px-3 py-1 rounded-full transition-all duration-300 border border-border/20 hover:border-border/30 group/players flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <Users
                        className={`${ICON_SIZE.sm.class} text-primary flex-shrink-0`}
                      />
                      <span>{players.length}</span>
                    </div>
                    <div className="text-muted-foreground">|</div>
                    <div
                      ref={playerListContainerRef}
                      className="relative cursor-pointer flex-1 min-w-0"
                      onMouseEnter={() => setIsHovered(true)}
                      onMouseLeave={() => setIsHovered(false)}
                      onMouseMove={handleMouseMove}
                      onClick={handleCopyPlayers}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleCopyPlayers();
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      title={t('locationHeader.clickToCopy')}
                    >
                      <div className="flex items-center gap-2 w-full">
                        {!isCopied ? (
                          <PlayerList
                            players={players}
                            maxVisiblePlayers={maxVisiblePlayers}
                          />
                        ) : (
                          <span className="text-success flex items-center gap-2">
                            <CheckIcon className={ICON_SIZE.sm.class} />
                            {t('locationHeader.copied')}
                          </span>
                        )}
                      </div>
                      {players &&
                        (createPortal(
                          <div
                            style={{
                              position: 'fixed',
                              visibility: isHovered ? 'visible' : 'hidden',
                              opacity: isHovered ? 1 : 0,
                              transition: 'opacity 200ms',
                              top: tooltipPosition.top,
                              left: tooltipPosition.left,
                            }}
                            className="z-50 p-4 bg-popover/95 backdrop-blur-md text-foreground text-sm rounded-lg shadow-xl border border-border/20"
                          >
                            <div className="flex flex-wrap gap-2">
                              {players.map((p: Player) => (
                                <span
                                  key={p.id}
                                  className="bg-muted text-muted-foreground px-3 py-1 rounded-full border border-border/50"
                                >
                                  {p.playerName}
                                </span>
                              ))}
                            </div>
                          </div>,
                          document.body,
                        ) as ReactPortal)}
                    </div>
                    <Copy
                      className={`${ICON_SIZE.sm.class} ml-2 text-foreground group-hover/players:text-foreground/80 transition-colors flex-shrink-0`}
                    />
                  </div>
                ) : (
                  // プレイヤーなし（取得済み、データなし = 0人）: 「プレイヤー情報なし」表示
                  <div className="flex gap-2 items-center text-xs text-foreground backdrop-blur-sm bg-background/30 px-3 py-1 rounded-full border border-border/20 flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <Users
                        className={`${ICON_SIZE.sm.class} text-primary flex-shrink-0`}
                      />
                      <span>0</span>
                    </div>
                    <div className="text-muted-foreground">|</div>
                    <span className="text-muted-foreground">
                      {t('locationHeader.noPlayerInfo')}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      <ShareDialog
        isOpen={isShareModalOpen}
        onClose={closeShareModal}
        worldName={details?.name || worldName}
        worldId={worldId}
        joinDateTime={joinDateTime}
        imageUrl={details?.imageUrl || null}
        players={players}
      />
    </div>
  );
};

// Re-export for backward compatibility
export { LocationGroupHeader as default } from './index';
