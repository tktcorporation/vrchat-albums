import { useMemo } from 'react';
import { match, P } from 'ts-pattern';

import { cn } from '@/components/lib/utils';

import type { RunStage } from '../../../../electron/module/initProgress/schema';
import { TEXT_COLOR, TYPOGRAPHY } from '../../constants/ui';
import { useCountUp } from '../../hooks/useCountUp';
import type {
  InitLaunch,
  InitProgressDetails,
  InitStats,
} from '../../hooks/useInitProgress';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion';
import { useStalled } from '../../hooks/useStalled';
import { useI18n } from '../../i18n/store';
import type { StartupLaunchVariant } from '../../i18n/types';
import { AppHeader } from '../AppHeader';
import {
  centerYearOf,
  chartMonthOf,
  RING_CENTER,
  RING_VIEWBOX,
  ringGeometry,
  type RingSector,
  sectorPath,
  toYearRings,
  yearMonthOf,
} from './photoRings';
import {
  formatMonthName,
  formatProgressDetail,
  formatStatsSummary,
} from './progressDetail';

/**
 * 区画の塗り。写真の多さは色相を変えずにアクセント色の濃さ（段階 1〜5）だけで表し、
 * 写真の無い月と今月より後の月は輪の位置が分かる程度の薄い下地だけを残す。
 */
const STEP_FILL = [
  'fill-muted-foreground/10',
  'fill-[color-mix(in_oklab,hsl(var(--primary))_30%,hsl(var(--density-base)))]',
  'fill-[color-mix(in_oklab,hsl(var(--primary))_47%,hsl(var(--density-base)))]',
  'fill-[color-mix(in_oklab,hsl(var(--primary))_63%,hsl(var(--density-base)))]',
  'fill-[color-mix(in_oklab,hsl(var(--primary))_80%,hsl(var(--density-base)))]',
  'fill-primary',
] as const;

/** 処理中の区画の縁取り線と区画の間隔（viewBox 上の長さ） */
const CURRENT_OUTLINE_OFFSET = 2.5;

const sectorFillClass = (sector: RingSector): string =>
  match(sector.tone)
    .with('current', () => 'fill-primary')
    .with(P.union('empty', 'future'), () => STEP_FILL[0])
    .with('counted', () => STEP_FILL[sector.step] ?? STEP_FILL[0])
    .exhaustive();

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
  /** 最も外側の輪の年と、それより後を空けておく月（`YYYY-MM`）。省略時はローカルタイムの今月 */
  currentMonth?: string;
}

/**
 * 起動時の読み込み画面。初回起動も 2 回目以降の差分読み込みも同じ画面で見せる。
 *
 * メインプロセスから届く累計（`stats`）を、1 年を 1 周、1 か月を 1 区画にした輪（年輪）に並べる。
 * 初回は写真が数えられるにつれて内側（古い年）から輪が埋まり、差分読み込みでは埋まった輪の
 * 新しい区画だけが濃くなる。
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

  // 範囲外の撮影月の写真を処理している間は、その枚数を足している端の区画を強調する
  const highlightMonth =
    runStage === 'photo_index' &&
    details?.unit === 'photos' &&
    details.currentItem !== undefined
      ? chartMonthOf(details.currentItem, month)
      : null;

  const rings = useMemo(
    () => toYearRings(stats?.months ?? [], month, highlightMonth),
    [stats, month, highlightMonth],
  );
  const geometry = useMemo(() => ringGeometry(rings.length), [rings.length]);

  // メインプロセスの進捗は数秒届かないことも、まとめて届くこともある。届いた値を超えない範囲で
  // 表示値を数え上げ、待っている間も処理が続いていると分かる動きを足す
  const reducedMotion = usePrefersReducedMotion();
  const shownProgress = useCountUp(overallProgress, {
    disabled: reducedMotion,
  });
  const running = match(runStage)
    .with(P.union('completed', 'error'), () => false)
    .with(
      P.union(
        null,
        'database_sync',
        'log_append',
        'log_load',
        'photo_index',
        'photo_metadata',
        'photo_log_import',
      ),
      () => true,
    )
    .exhaustive();
  // 動きを減らす設定では、光と待ちの帯を出さず静止したバーだけにする
  const animating = running && !reducedMotion;
  const stalled = useStalled(overallProgress, { active: animating });
  const centerYear = centerYearOf(rings, highlightMonth);

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

  const summary = formatStatsSummary(
    stats,
    language,
    t('initProgress.timeline.summary'),
  );

  return (
    <div
      className="h-screen flex flex-col overflow-hidden bg-background"
      data-testid="loading-screen"
    >
      <AppHeader showGalleryControls={false} />
      <main className="flex-1 min-h-0 overflow-y-auto grid grid-rows-[minmax(20rem,1fr)_auto] gap-8 px-6 py-8 min-[720px]:grid-rows-1 min-[720px]:grid-cols-[11fr_9fr] min-[720px]:gap-12 min-[720px]:px-12 min-[720px]:py-10">
        <svg
          role="img"
          aria-label={t('initProgress.timeline.chartLabel')}
          viewBox={`0 0 ${RING_VIEWBOX} ${RING_VIEWBOX}`}
          className="size-full min-h-80"
          data-testid="startup-rings"
        >
          {rings.map((ring, ringIndex) => {
            const g = geometry[ringIndex];
            return (
              <g key={ring.year} data-year={ring.year}>
                {ring.sectors.map((sector, monthIndex) => (
                  <path
                    key={sector.month}
                    d={sectorPath(g, monthIndex)}
                    className={cn(
                      'transition-colors duration-500 ease-out motion-reduce:transition-none',
                      sectorFillClass(sector),
                    )}
                    data-month={sector.month}
                    data-tone={sector.tone}
                    data-step={sector.step}
                  />
                ))}
                {g.labelled && (
                  <text
                    x={RING_CENTER}
                    y={g.labelY}
                    textAnchor="middle"
                    dominantBaseline="central"
                    className={cn('fill-current', TYPOGRAPHY.caption.figure)}
                    aria-hidden="true"
                  >
                    {ring.year}
                  </text>
                )}
              </g>
            );
          })}
          {/* 処理中の区画は塗りを最も濃くした上で、隙間を挟んだ外側に細い線を引く。
              濃さだけでは最も写真の多い月（段階 5）と見分けにくく、点滅させずに区別するため。
              外側の輪に隠れないよう、すべての輪を描いた後に重ねる */}
          {rings.flatMap((ring, ringIndex) =>
            ring.sectors.flatMap((sector, monthIndex) =>
              sector.tone === 'current'
                ? [
                    <path
                      key={`${sector.month}-outline`}
                      d={sectorPath(
                        geometry[ringIndex],
                        monthIndex,
                        CURRENT_OUTLINE_OFFSET,
                      )}
                      fill="none"
                      strokeWidth={1.25}
                      className="stroke-primary"
                      data-testid="startup-current-outline"
                    />,
                  ]
                : [],
            ),
          )}
          <g aria-hidden="true">
            <text
              x={RING_CENTER}
              y={highlightMonth === null ? RING_CENTER : RING_CENTER - 8}
              textAnchor="middle"
              dominantBaseline="central"
              className={cn(
                'fill-current',
                TYPOGRAPHY.display.numeral,
                TEXT_COLOR.primary,
              )}
              data-testid="startup-center-year"
            >
              {centerYear}
            </text>
            {highlightMonth !== null && (
              <text
                x={RING_CENTER}
                y={RING_CENTER + 34}
                textAnchor="middle"
                dominantBaseline="central"
                className={cn(
                  'fill-current',
                  TYPOGRAPHY.body.primary,
                  TEXT_COLOR.secondary,
                )}
                data-testid="startup-center-month"
              >
                {formatMonthName(highlightMonth, language)}
              </text>
            )}
          </g>
        </svg>

        <div className="mx-auto flex w-full max-w-sm flex-col justify-center gap-6 min-[720px]:mx-0">
          <h1
            className={cn(TYPOGRAPHY.heading.primary, TEXT_COLOR.primary)}
            data-testid="startup-headline"
          >
            {t(`initProgress.timeline.headline.${variant}`)}
          </h1>

          {/* 読み上げはフェーズの切り替わりだけに絞る。割合と件数は 1 秒に何度も変わるため、
              ライブリージョンに含めると読み上げが途切れなく続く。割合は progressbar の aria-valuenow が持つ */}
          <div className="flex flex-col gap-2">
            <span
              role="status"
              aria-live="polite"
              className={cn(TYPOGRAPHY.body.primary, TEXT_COLOR.primary)}
              data-testid="progress-message"
            >
              {phaseLabel}
            </span>
            <div className="flex items-center gap-2">
              {/* aria-valuenow と data-progress は届いた実際の値を持ち、見た目だけを数え上げる */}
              <div
                role="progressbar"
                aria-label={t('initProgress.timeline.progressLabel')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={overallProgress}
                className="relative h-0.5 flex-1 overflow-hidden rounded-full bg-muted-foreground/20"
                data-stalled={stalled}
              >
                <div
                  className="relative h-full overflow-hidden rounded-full bg-primary"
                  style={{ width: `${shownProgress}%` }}
                  data-testid="progress-bar"
                  data-progress={overallProgress}
                >
                  {/* 塗られた部分を薄い光が通り続け、値が動かない間も止まって見えないようにする */}
                  {animating && (
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-0 left-0 w-1/2 animate-progress-sheen bg-gradient-to-r from-transparent via-primary-foreground/60 to-transparent"
                      data-testid="progress-sheen"
                    />
                  )}
                </div>
                {/* 進捗が止まっている間だけ、残り部分に帯を流して待ち状態を示す。値は作らない */}
                {stalled && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 right-0 overflow-hidden"
                    style={{ left: `${shownProgress}%` }}
                    data-testid="progress-pending"
                  >
                    <span className="absolute inset-y-0 left-0 w-1/3 animate-progress-pending bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
                  </span>
                )}
              </div>
              <span
                className={cn(
                  'w-10 tabular-nums',
                  TYPOGRAPHY.body.primary,
                  TEXT_COLOR.secondary,
                )}
                data-testid="progress-percent"
              >
                {`${shownProgress}%`}
              </span>
            </div>
            <span
              className={cn(
                // 区切りの空白を詰めずに表示する（文言側で項目の間を空白で区切っている）
                'min-h-[1lh] whitespace-pre tabular-nums',
                TYPOGRAPHY.body.primary,
                TEXT_COLOR.secondary,
              )}
              data-testid="progress-detail"
            >
              {detailLine}
            </span>
          </div>

          <p
            className={cn(
              'min-h-[1lh] whitespace-pre tabular-nums',
              TYPOGRAPHY.body.secondary,
              TEXT_COLOR.secondary,
            )}
            data-testid="startup-summary"
          >
            {summary}
          </p>
        </div>
      </main>
    </div>
  );
};
