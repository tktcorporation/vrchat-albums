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

  // クリック位置から最も近い日付を見つける
  const handleSidebarClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (!sidebarRef.current || dateSummaries.length === 0) return;

      const rect = sidebarRef.current.getBoundingClientRect();
      const clickY = e.clientY - rect.top;
      const clickPercent = (clickY / rect.height) * 100;

      // クリック位置に最も近い日付を見つける
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

      const summary = dateSummaries[closestIndex];
      const firstGroupIndex = summary.groupIndices[0];
      onJumpToDate(firstGroupIndex);

      // クリック後はスクロール状態をリセット（ホバー状態は維持）
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      setIsScrolling(false);
    },
    [dateSummaries, onJumpToDate],
  );

  // 日付の位置を計算（パディングを考慮した配置）
  const getDatePosition = (index: number) => {
    if (dateSummaries.length <= 1) return 50;
    // 上下に5%ずつ余白を確保して、10%〜90%の範囲に配置
    const paddingPercent = 10;
    const usableRange = 100 - paddingPercent * 2;
    return paddingPercent + (index / (dateSummaries.length - 1)) * usableRange;
  };

  return (
    <div
      ref={sidebarRef}
      className={cn(
        'fixed right-0 top-12 bottom-0 transition-all duration-300 z-10',
        isHovering || isScrolling ? 'w-24' : 'w-2',
        'group cursor-pointer',
        className,
      )}
      onClick={handleSidebarClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const rect = sidebarRef.current?.getBoundingClientRect();
          if (rect) {
            const mockEvent = {
              clientY: rect.top + rect.height / 2,
            } as MouseEvent<HTMLDivElement>;
            handleSidebarClick(mockEvent);
          }
        }
      }}
      role="navigation"
      aria-label="日付ジャンプサイドバー"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => {
        setIsHovering(false);
        setHoveredDate(null);
      }}
      onMouseMove={(e) => {
        if (!sidebarRef.current || dateSummaries.length === 0) return;

        const rect = sidebarRef.current.getBoundingClientRect();
        const mouseY = e.clientY - rect.top;
        const mousePercent = (mouseY / rect.height) * 100;

        // マウス位置に最も近い日付を見つける
        let closestDate: string | null = null;
        let minDistance = Number.POSITIVE_INFINITY;

        dateSummaries.forEach((summary, index) => {
          const datePercent = getDatePosition(index);
          const distance = Math.abs(datePercent - mousePercent);
          if (distance < minDistance) {
            minDistance = distance;
            closestDate = summary.date;
          }
        });

        setHoveredDate(closestDate);
      }}
    >
      {/* 背景 - 極めて薄いグラデーション */}
      <div
        className={cn(
          'absolute inset-0 transition-all duration-300',
          isHovering || isScrolling
            ? 'bg-gradient-to-l from-background/5 to-transparent opacity-100'
            : 'opacity-0',
        )}
      />

      {/* スクロール位置インジケーター - 常時表示（水平ラインポインター） */}
      <div
        className={cn(
          'absolute right-0 h-0.5 bg-primary rounded-full transition-all duration-150',
          isHovering || isScrolling ? 'w-10' : 'w-4',
        )}
        style={{
          top: `${indicatorPosition}%`,
        }}
      />

      {/* タイムライン - 透明度でアニメーション */}
      <div
        className={cn(
          'absolute right-0 w-24 h-full py-12 transition-opacity duration-300',
          isHovering || isScrolling ? 'opacity-100' : 'opacity-0',
        )}
      >
        {/* 年の区切りとラベル - Google Photo風 */}
        {(() => {
          // 各年の最初の日付（配列内では最後）を見つける
          const yearFirstIndices = new Map<string, number>();
          for (let i = dateSummaries.length - 1; i >= 0; i--) {
            const year = dateSummaries[i].date.split('-')[0];
            if (!yearFirstIndices.has(year)) {
              yearFirstIndices.set(year, i);
            }
          }

          return Array.from(yearFirstIndices.entries()).map(([year, index]) => (
            <div
              key={`year-${year}`}
              className="absolute left-0 right-0 z-10 pointer-events-none"
              style={{ top: `${getDatePosition(index)}%` }}
            >
              {(isHovering || isScrolling) && (
                <div
                  className="absolute right-3 -translate-y-1/2"
                  style={{ top: '50%' }}
                >
                  <span className="text-xs font-medium text-foreground/70 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
                    {year}
                  </span>
                </div>
              )}
            </div>
          ));
        })()}

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

              {/* ホバー時の日付表示 - Google Photo風のシンプルなポップアップ */}
              {(isHovering || isScrolling) && isHovered && (
                <div
                  className={cn(
                    'absolute right-full mr-4 top-1/2 -translate-y-1/2',
                    'bg-background/95 backdrop-blur-sm bg-gray-100 dark:bg-gray-800',
                    'rounded-md shadow-sm',
                    'px-2 py-1',
                    'text-[11px] font-medium text-foreground',
                    'whitespace-nowrap',
                    // 'animate-in fade-in-0 duration-10',
                  )}
                >
                  {format(new Date(summary.date), 'M月d日', {
                    locale: ja,
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
