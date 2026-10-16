import { useMemo } from 'react';
import { match, P } from 'ts-pattern';

import { cn } from '@/components/lib/utils';

import type { RunStage } from '../../../../electron/module/initProgress/schema';
import { TEXT_COLOR, TYPOGRAPHY } from '../../constants/ui';
import type {
  InitLaunch,
  InitProgressDetails,
  InitStats,
} from '../../hooks/useInitProgress';
import { useI18n } from '../../i18n/store';
import type { StartupLaunchVariant } from '../../i18n/types';
import { AppHeader } from '../AppHeader';
import {
  type BarTone,
  fillMonthRange,
  toMonthBars,
  yearMonthOf,
  yearSpans,
} from './monthlyBars';
import { formatCount, formatProgressDetail } from './progressDetail';

/**
 * 棒 1 本の最大幅。撮影期間が数か月しか無いときに棒が画面幅いっぱいに太らないよう、
 * グラフ全体の幅を「月数 × この値」で頭打ちにする。
 */
const MAX_BAR_WIDTH_PX = 32;

/** 写真が無い月や枚数の少ない月でも、月の位置が見えるように残す最低の高さ */
const MIN_BAR_HEIGHT_PX = 3;

/**
 * 年ラベルを出すのに要る最低の月数。撮影期間の端の年が 1〜2 か月しか無いと、
 * 隣の年のラベルと重なって読めなくなるため、その年はラベルを出さない。
 */
const MIN_LABEL_SPAN = 3;

const COUNTER_KEYS = ['photos', 'worlds', 'people'] as const;

const BAR_TONE_CLASS = {
  current: 'bg-primary',
  counted: 'bg-primary/60',
  empty: 'bg-muted-foreground/20',
} as const satisfies Record<BarTone, string>;

/**
 * 月数が増えて棒が細くなっても、隙間が棒より太くならないように隙間（px）を詰める。
 */
const barGapPx = (monthCount: number): number => {
  if (monthCount > 96) {
    return 1;
  }
  return monthCount > 48 ? 2 : 4;
};

const launchVariantOf = (
  syncMode: InitLaunch['syncMode'] | null,
  isFirstLaunch: boolean | null,
): StartupLaunchVariant =>
  match({ syncMode, isFirstLaunch })
    .with({ isFirstLaunch: true }, () => 'firstLaunch' as const)
    .with(
      { isFirstLaunch: false, syncMode: 'full' },
      () => 'fullResync' as const,
    )
    .with(
      { isFirstLaunch: false, syncMode: 'incremental' },
      () => 'incremental' as const,
    )
    .with({ isFirstLaunch: false, syncMode: null }, () => 'pending' as const)
    .with({ isFirstLaunch: null }, () => 'pending' as const)
    .exhaustive();

interface StartupTimelineScreenProps {
  /** 最後に届いた進捗イベントのステージ。まだ何も届いていなければ null */
  runStage: RunStage | null;
  /** 全体進捗（0-100） */
  overallProgress: number;
  details: InitProgressDetails | null;
  syncMode: InitLaunch['syncMode'] | null;
  isFirstLaunch: boolean | null;
  stats: InitStats | null;
  /** 横軸の右端にする月（`YYYY-MM`）。省略時はローカルタイムの今月 */
  currentMonth?: string;
}

/**
 * 起動時の読み込み画面。初回起動も 2 回目以降の差分読み込みも同じ画面で見せる。
 *
 * メインプロセスから届く累計（`stats`）を撮影月ごとの棒グラフにするので、
 * 初回は棒が古い月から順に伸び、差分読み込みでは既存の棒が並んだ状態から新しい月だけが伸びる。
 */
export const StartupTimelineScreen = ({
  runStage,
  overallProgress,
  details,
  syncMode,
  isFirstLaunch,
  stats,
  currentMonth,
}: StartupTimelineScreenProps) => {
  const { t, language } = useI18n();
  const variant = launchVariantOf(syncMode, isFirstLaunch);
  const month = currentMonth ?? yearMonthOf(new Date());

  const highlightMonth =
    runStage === 'photo_index' && details?.unit === 'photos'
      ? (details.currentItem ?? null)
      : null;

  const bars = useMemo(
    () =>
      toMonthBars(fillMonthRange(stats?.months ?? [], month), highlightMonth),
    [stats, month, highlightMonth],
  );
  const years = useMemo(() => yearSpans(bars.map((b) => b.month)), [bars]);

  const phaseLabel = match(runStage)
    .with(null, () => t('common.loading'))
    .with('completed', () => t('initProgress.timeline.ready'))
    .with(
      P.union(
        'database_sync',
        'log_append',
        'log_load',
        'photo_index',
        'photo_metadata',
        'photo_log_import',
        'error',
      ),
      (stage) => t(`initProgress.stage.${stage}`),
    )
    .exhaustive();

  const detailLine =
    runStage === 'completed'
      ? ''
      : formatProgressDetail(details, language, {
          photosInMonth: t('initProgress.timeline.detail.photosInMonth'),
          photos: t('initProgress.timeline.detail.photos'),
          files: t('initProgress.timeline.detail.files'),
          logs: t('initProgress.timeline.detail.logs'),
        });

  // 月が 0 件のときは幅を頭打ちにせず、空の横軸を全幅で見せる
  const gridStyle = {
    gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))`,
    maxWidth:
      bars.length > 0 ? `${bars.length * MAX_BAR_WIDTH_PX}px` : undefined,
    columnGap: `${barGapPx(bars.length)}px`,
  };

  return (
    <div
      className="h-screen flex flex-col overflow-hidden bg-background"
      data-testid="loading-screen"
    >
      <AppHeader showGalleryControls={false} />
      <main className="flex-1 min-h-0 flex flex-col gap-8 px-8 pt-10 pb-8 md:px-16 md:pt-12 md:pb-10">
        <div className="flex flex-col gap-3 max-w-2xl">
          {/* 小さな文字をアクセント色で塗るとライトテーマで読める濃さが足りないため、
              アクセント色は文字の前の短い線に持たせ、文字は本文の補助色で書く */}
          <span
            className={cn(
              'flex items-center gap-2',
              TYPOGRAPHY.overline,
              TEXT_COLOR.secondary,
            )}
            data-testid="startup-eyebrow"
          >
            <span
              aria-hidden="true"
              className="h-0.5 w-4 rounded-full bg-primary"
            />
            {t(`initProgress.timeline.eyebrow.${variant}`)}
          </span>
          <h1
            className={cn(
              TYPOGRAPHY.display.page,
              'tracking-tight whitespace-pre-line',
              TEXT_COLOR.primary,
            )}
            data-testid="startup-headline"
          >
            {t(`initProgress.timeline.headline.${variant}`)}
          </h1>
        </div>

        <div className="flex-1 min-h-0 flex flex-col justify-end gap-2">
          <div
            role="img"
            aria-label={t('initProgress.timeline.chartLabel')}
            className="grid w-full flex-1 min-h-16 max-h-60"
            style={{ ...gridStyle, gridTemplateRows: '100%' }}
            data-testid="startup-month-chart"
          >
            {bars.map((bar) => (
              <div
                key={bar.month}
                aria-hidden="true"
                className={cn(
                  'self-end rounded-t-sm transition-[height] duration-500 ease-out motion-reduce:transition-none',
                  BAR_TONE_CLASS[bar.tone],
                )}
                style={{
                  height: `max(${MIN_BAR_HEIGHT_PX}px, ${bar.ratio * 100}%)`,
                }}
                data-month={bar.month}
                data-tone={bar.tone}
              />
            ))}
          </div>
          <div
            className="grid w-full border-t border-border pt-2"
            style={gridStyle}
            aria-hidden="true"
          >
            {years.map((y) => (
              <span
                key={y.year}
                className={cn(
                  'overflow-hidden whitespace-nowrap tabular-nums',
                  TYPOGRAPHY.caption.default,
                )}
                style={{ gridColumn: `${y.start + 1} / span ${y.span}` }}
              >
                {y.span >= MIN_LABEL_SPAN || years.length === 1 ? y.year : ''}
              </span>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-8">
          <dl className="flex gap-10">
            {COUNTER_KEYS.map((key) => (
              <div key={key} className="flex flex-col gap-0.5">
                <dt className={TYPOGRAPHY.caption.default}>
                  {t(`initProgress.timeline.counters.${key}`)}
                </dt>
                <dd
                  className={cn(
                    'order-first',
                    TYPOGRAPHY.display.metric,
                    TEXT_COLOR.primary,
                  )}
                  data-testid={`startup-counter-${key}`}
                >
                  {formatCount(stats?.[key] ?? 0, language)}
                </dd>
              </div>
            ))}
          </dl>

          {/* 読み上げはフェーズの切り替わりだけに絞る。割合と件数は 1 秒に何度も変わるため、
              ライブリージョンに含めると読み上げが途切れなく続く。割合は progressbar の aria-valuenow が持つ */}
          <div className="flex w-80 max-w-full flex-col gap-2 lg:w-96">
            <div className="flex items-baseline justify-between gap-3">
              <span
                role="status"
                aria-live="polite"
                className={cn(TYPOGRAPHY.body.emphasis, TEXT_COLOR.primary)}
                data-testid="progress-message"
              >
                {phaseLabel}
              </span>
              <span
                className={cn('tabular-nums', TYPOGRAPHY.caption.default)}
                data-testid="progress-percent"
              >
                {`${overallProgress}%`}
              </span>
            </div>
            <div
              role="progressbar"
              aria-label={t('initProgress.timeline.progressLabel')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={overallProgress}
              className="h-1 overflow-hidden rounded-full bg-muted-foreground/20"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out motion-reduce:transition-none"
                style={{ width: `${overallProgress}%` }}
                data-testid="progress-bar"
                data-progress={overallProgress}
              />
            </div>
            <span
              className={cn(
                'min-h-[1lh] tabular-nums',
                TYPOGRAPHY.caption.default,
              )}
              data-testid="progress-detail"
            >
              {detailLine}
            </span>
          </div>
        </div>
      </main>
    </div>
  );
};
