import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  type FC,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { match } from 'ts-pattern';
import { cn } from '@/components/lib/utils';
import type { GroupedPhoto } from '../useGroupPhotos';

export interface DateIndex {
  dateToGroups: Map<string, number[]>;
  sortedDates: string[];
  groupToDates: Map<number, string>;
}

export interface DateSummary {
  date: string;
  label: string;
  photoCount: number;
  groupIndices: number[];
  year?: string;
  month?: string;
  normalizedHeight: number;
}

export interface MonthSummary {
  yearMonth: string; // 'YYYY-MM'
  year: string;
  month: string;
  label: string; // 'M月'
  photoCount: number;
  dateCount: number;
  firstDateIndex: number; // dateSummaries内の最初の日付のインデックス
  isFirstOfYear: boolean;
}

interface DateJumpSidebarProps {
  groups: GroupedPhoto[];
  onJumpToDate: (groupIndex: number) => void;
  currentGroupIndex?: number;
  className?: string;
  scrollContainer?: HTMLElement | null;
}

export const DateJumpSidebar: FC<DateJumpSidebarProps> = ({
  groups,
  onJumpToDate,
  currentGroupIndex,
  className,
  scrollContainer,
}) => {
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [isScrolling, setIsScrolling] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [hoverY, setHoverY] = useState<number | null>(null);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // スクロール状態の検知
  useEffect(() => {
    if (!scrollContainer) return;

    const handleScroll = () => {
      setIsScrolling(true);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      scrollTimeoutRef.current = setTimeout(() => {
        setIsScrolling(false);
      }, 500);
    };

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [scrollContainer]);

  // 日付インデックスを生成
  const dateIndex = useMemo<DateIndex>(() => {
    const dateToGroups = new Map<string, number[]>();
    const groupToDates = new Map<number, string>();

    groups.forEach((group, index) => {
      const date = format(group.joinDateTime, 'yyyy-MM-dd');
      const existing = dateToGroups.get(date) || [];
      existing.push(index);
      dateToGroups.set(date, existing);
      groupToDates.set(index, date);
    });

    const sortedDates = Array.from(dateToGroups.keys()).sort().reverse();

    return { dateToGroups, sortedDates, groupToDates };
  }, [groups]);

  // 日付サマリーを生成
  const dateSummaries = useMemo<DateSummary[]>(() => {
    let lastYear: string | null = null;
    let lastMonth: string | null = null;

    // 最大写真枚数を計算
    const maxPhotoCount = Math.max(
      ...dateIndex.sortedDates.map((date) => {
        const groupIndices = dateIndex.dateToGroups.get(date) || [];
        return groupIndices.reduce(
          (sum, idx) => sum + groups[idx].photos.length,
          0,
        );
      }),
    );

    return dateIndex.sortedDates.map((date) => {
      const [year, month, day] = date.split('-');
      const groupIndices = dateIndex.dateToGroups.get(date) || [];
      const photoCount = groupIndices.reduce(
        (sum, idx) => sum + groups[idx].photos.length,
        0,
      );

      const normalizedHeight = Math.max(0.2, photoCount / maxPhotoCount);

      const summary: DateSummary = {
        date,
        label: `${Number.parseInt(day, 10)}日`,
        photoCount,
        groupIndices,
        normalizedHeight,
      };

      // 年が変わった場合
      match(year !== lastYear)
        .with(true, () => {
          summary.year = year;
          lastYear = year;
        })
        .otherwise(() => {});

      // 月が変わった場合
      match(month !== lastMonth)
        .with(true, () => {
          summary.month = `${Number.parseInt(month, 10)}月`;
          lastMonth = month;
        })
        .otherwise(() => {});

      return summary;
    });
  }, [dateIndex, groups]);

  // 月サマリーを生成（月単位のセグメント表示用）
  const monthSummaries = useMemo<MonthSummary[]>(() => {
    const monthMap = new Map<
      string,
      { photoCount: number; dateIndices: number[] }
    >();

    dateSummaries.forEach((summary, index) => {
      const yearMonth = summary.date.substring(0, 7); // 'YYYY-MM'
      const existing = monthMap.get(yearMonth) || {
        photoCount: 0,
        dateIndices: [],
      };
      existing.photoCount += summary.photoCount;
      existing.dateIndices.push(index);
      monthMap.set(yearMonth, existing);
    });

    let lastYear: string | null = null;
    const sortedYearMonths = Array.from(monthMap.keys()).sort().reverse();

    return sortedYearMonths.flatMap((yearMonth) => {
      const [year, month] = yearMonth.split('-');
      const data = monthMap.get(yearMonth);
      if (!data) return [];

      const isFirstOfYear = year !== lastYear;
      lastYear = year;

      return [
        {
          yearMonth,
          year,
          month,
          label: `${Number.parseInt(month, 10)}月`,
          photoCount: data.photoCount,
          dateCount: data.dateIndices.length,
          firstDateIndex: Math.min(...data.dateIndices),
          isFirstOfYear,
        },
      ];
    });
  }, [dateSummaries]);

  // 現在表示中の日付
  const currentDate = useMemo(() => {
    return match(currentGroupIndex)
      .with(undefined, () => null)
      .otherwise((idx) => dateIndex.groupToDates.get(idx) || null);
  }, [currentGroupIndex, dateIndex]);

  // 水平ラインインジケーターの位置（currentDateと同期）
  const indicatorPosition = useMemo(() => {
    if (!currentDate) return 10;
    const index = dateSummaries.findIndex((s) => s.date === currentDate);
    if (index < 0) return 10;
    if (dateSummaries.length <= 1) return 50;
    const paddingPercent = 10;
    const usableRange = 100 - paddingPercent * 2;
    return paddingPercent + (index / (dateSummaries.length - 1)) * usableRange;
  }, [currentDate, dateSummaries]);

  // 日付の位置を計算（パディングを考慮した配置）
  const getDatePosition = useCallback(
    (index: number) => {
      if (dateSummaries.length <= 1) return 50;
      const paddingPercent = 10;
      const usableRange = 100 - paddingPercent * 2;
      return (
        paddingPercent + (index / (dateSummaries.length - 1)) * usableRange
      );
    },
    [dateSummaries.length],
  );

  // Y座標から最も近い日付インデックスを取得
  const getClosestDateIndex = useCallback(
    (clientY: number) => {
      if (!sidebarRef.current || dateSummaries.length === 0) return 0;

      const rect = sidebarRef.current.getBoundingClientRect();
      const clickY = clientY - rect.top;
      const clickPercent = (clickY / rect.height) * 100;

      let closestIndex = 0;
      let minDistance = Number.POSITIVE_INFINITY;

      dateSummaries.forEach((_, index) => {
        const datePercent = getDatePosition(index);
        const distance = Math.abs(datePercent - clickPercent);
        if (distance < minDistance) {
          minDistance = distance;
          closestIndex = index;
        }
      });

      return closestIndex;
    },
    [dateSummaries, getDatePosition],
  );

  // スクラブ操作（ドラッグ中の位置更新）
  const handleScrub = useCallback(
    (clientY: number) => {
      const closestIndex = getClosestDateIndex(clientY);
      const summary = dateSummaries[closestIndex];
      if (summary) {
        const firstGroupIndex = summary.groupIndices[0];
        onJumpToDate(firstGroupIndex);
      }
    },
    [dateSummaries, getClosestDateIndex, onJumpToDate],
  );

  // ドラッグ開始（マウス）
  const handleMouseDown = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(true);
      handleScrub(e.clientY);
    },
    [handleScrub],
  );

  // タッチ開始
  const handleTouchStart = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      setIsDragging(true);
      setIsHovering(true);
      const touch = e.touches[0];
      handleScrub(touch.clientY);
      if (sidebarRef.current) {
        const rect = sidebarRef.current.getBoundingClientRect();
        setHoverY(touch.clientY - rect.top);
      }
    },
    [handleScrub],
  );

  // ドラッグ・タッチ中の移動（グローバル）
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: globalThis.MouseEvent) => {
      handleScrub(e.clientY);
      if (sidebarRef.current) {
        const rect = sidebarRef.current.getBoundingClientRect();
        setHoverY(e.clientY - rect.top);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      handleScrub(touch.clientY);
      if (sidebarRef.current) {
        const rect = sidebarRef.current.getBoundingClientRect();
        setHoverY(touch.clientY - rect.top);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    const handleTouchEnd = () => {
      setIsDragging(false);
      setIsHovering(false);
      setHoveredDate(null);
      setHoverY(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchmove', handleTouchMove, { passive: true });
    document.addEventListener('touchend', handleTouchEnd);
    document.addEventListener('touchcancel', handleTouchEnd);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [isDragging, handleScrub]);

  // クリック位置から最も近い日付を見つける
  const handleSidebarClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      // ドラッグ中はクリックとして処理しない
      if (isDragging) return;

      const closestIndex = getClosestDateIndex(e.clientY);
      const summary = dateSummaries[closestIndex];
      if (summary) {
        const firstGroupIndex = summary.groupIndices[0];
        onJumpToDate(firstGroupIndex);
      }

      // クリック後はスクロール状態をリセット（ホバー状態は維持）
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      setIsScrolling(false);
    },
    [dateSummaries, getClosestDateIndex, isDragging, onJumpToDate],
  );

  // 展開状態（ホバー、スクロール、ドラッグのいずれか）
  const isExpanded = isHovering || isScrolling || isDragging;

  // 現在のインデックス（キーボードナビゲーション用）
  const currentDateIndex = useMemo(() => {
    if (!currentDate) return 0;
    return dateSummaries.findIndex((s) => s.date === currentDate);
  }, [currentDate, dateSummaries]);

  // キーボードナビゲーション
  const handleKeyNavigation = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (dateSummaries.length === 0) return;

      let targetIndex: number | null = null;

      match(e.key)
        .with('ArrowUp', () => {
          e.preventDefault();
          targetIndex = Math.max(0, currentDateIndex - 1);
        })
        .with('ArrowDown', () => {
          e.preventDefault();
          targetIndex = Math.min(
            dateSummaries.length - 1,
            currentDateIndex + 1,
          );
        })
        .with('Home', () => {
          e.preventDefault();
          targetIndex = 0;
        })
        .with('End', () => {
          e.preventDefault();
          targetIndex = dateSummaries.length - 1;
        })
        .with('Enter', ' ', () => {
          e.preventDefault();
          const rect = sidebarRef.current?.getBoundingClientRect();
          if (rect) {
            const mockEvent = {
              clientY: rect.top + rect.height / 2,
            } as MouseEvent<HTMLDivElement>;
            handleSidebarClick(mockEvent);
          }
        })
        .otherwise(() => {});

      if (targetIndex !== null) {
        const summary = dateSummaries[targetIndex];
        if (summary) {
          const firstGroupIndex = summary.groupIndices[0];
          onJumpToDate(firstGroupIndex);
        }
      }
    },
    [currentDateIndex, dateSummaries, handleSidebarClick, onJumpToDate],
  );

  // スクロールバーのARIA値（パーセント）
  const ariaValueNow = useMemo(() => {
    if (dateSummaries.length <= 1) return 0;
    return Math.round((currentDateIndex / (dateSummaries.length - 1)) * 100);
  }, [currentDateIndex, dateSummaries.length]);

  return (
    <div
      ref={sidebarRef}
      className={cn(
        'fixed right-0 top-12 bottom-0 transition-all duration-300 z-10',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
        isExpanded ? 'w-24' : 'w-6',
        isDragging ? 'cursor-row-resize' : 'cursor-pointer',
        className,
      )}
      onClick={handleSidebarClick}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      onKeyDown={handleKeyNavigation}
      role="slider"
      aria-label="日付ナビゲーション"
      aria-orientation="vertical"
      aria-valuenow={ariaValueNow}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={
        currentDate
          ? format(new Date(currentDate), 'yyyy年M月d日', { locale: ja })
          : undefined
      }
      tabIndex={0}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => {
        if (!isDragging) {
          setIsHovering(false);
          setHoveredDate(null);
          setHoverY(null);
        }
      }}
      onMouseMove={(e) => {
        if (!sidebarRef.current || dateSummaries.length === 0) return;

        const rect = sidebarRef.current.getBoundingClientRect();
        const mouseY = e.clientY - rect.top;
        setHoverY(mouseY);

        // マウス位置に最も近い日付を見つける
        const closestIndex = getClosestDateIndex(e.clientY);
        setHoveredDate(dateSummaries[closestIndex]?.date || null);
      }}
    >
      {/* 背景 - 極めて薄いグラデーション */}
      <div
        className={cn(
          'absolute inset-0 transition-all duration-300',
          isExpanded
            ? 'bg-gradient-to-l from-background/5 to-transparent opacity-100'
            : 'opacity-0',
        )}
      />

      {/* スクロール位置インジケーター - 常時表示（水平ラインポインター） */}
      <div
        className={cn(
          'absolute right-0 h-0.5 bg-primary rounded-full shadow-sm',
          'transition-all duration-200 ease-out',
          isExpanded ? 'w-10 shadow-md' : 'w-4',
        )}
        style={{
          top: `${indicatorPosition}%`,
          boxShadow: isExpanded
            ? '0 0 8px rgba(var(--primary), 0.4)'
            : undefined,
        }}
      />

      {/* 現在日付ラベル - 常時表示（縮小時も見える） */}
      {currentDate && !isExpanded && (
        <div
          className="absolute right-6 text-[10px] font-medium text-foreground/60 whitespace-nowrap transition-opacity duration-300"
          style={{
            top: `${indicatorPosition}%`,
            transform: 'translateY(-50%)',
          }}
        >
          {format(new Date(currentDate), 'M/d', { locale: ja })}
        </div>
      )}

      {/* タイムライン - スライドイン + 透明度アニメーション */}
      <div
        className={cn(
          'absolute right-0 w-24 h-full py-12',
          'transition-all duration-300 ease-out',
          isExpanded
            ? 'opacity-100 translate-x-0'
            : 'opacity-0 translate-x-2 pointer-events-none',
        )}
      >
        {/* 月セグメントと年ラベル - Google Photo風 */}
        {monthSummaries.map((monthSummary) => (
          <div
            key={`month-${monthSummary.yearMonth}`}
            className="absolute left-0 right-0 z-10 pointer-events-none"
            style={{ top: `${getDatePosition(monthSummary.firstDateIndex)}%` }}
          >
            {isExpanded && (
              <div
                className="absolute right-3 -translate-y-1/2 flex items-center gap-1"
                style={{ top: '50%' }}
              >
                {/* 年ラベル（年の最初の月のみ表示） */}
                {monthSummary.isFirstOfYear && (
                  <span className="text-xs font-medium text-foreground/70 bg-muted px-1.5 py-0.5 rounded">
                    {monthSummary.year}
                  </span>
                )}
                {/* 月ラベル */}
                <span className="text-[10px] text-foreground/50">
                  {monthSummary.label}
                </span>
              </div>
            )}
          </div>
        ))}

        {/* 各日付のビジュアル表現 */}
        {dateSummaries.map((summary, index) => {
          const isCurrentDate = currentDate === summary.date;
          const isHovered = hoveredDate === summary.date;

          return (
            <div
              key={summary.date}
              className="absolute right-2 z-20 pointer-events-none"
              style={{
                top: `${getDatePosition(index)}%`,
                transform: 'translateY(-50%)',
              }}
            >
              {/* 日付のドット - Google Photo風の均一サイズ */}
              <div className="relative">
                <div
                  className={cn(
                    'w-1 h-1 rounded-full transition-all duration-300',
                    isCurrentDate
                      ? 'bg-primary scale-150'
                      : isHovered
                        ? 'bg-foreground/80 scale-125'
                        : 'bg-foreground/30',
                  )}
                />
              </div>
            </div>
          );
        })}

        {/* ホバー時の日付ラベル - マウス位置に追従 */}
        {isExpanded && hoveredDate && hoverY !== null && (
          <div
            className={cn(
              'absolute right-6 z-30 pointer-events-none',
              'bg-muted/95 backdrop-blur-sm',
              'rounded-md',
              'px-2 py-1',
              'text-[11px] font-medium text-foreground',
              'whitespace-nowrap',
              'shadow-lg',
              'transition-opacity duration-100',
            )}
            style={{
              top: hoverY,
              transform: 'translateY(-50%)',
            }}
          >
            {format(new Date(hoveredDate), 'M月d日', { locale: ja })}
          </div>
        )}
      </div>
    </div>
  );
};
