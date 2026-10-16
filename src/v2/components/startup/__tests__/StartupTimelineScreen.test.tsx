import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useI18n } from '../../../i18n/store';
import { StartupTimelineScreen } from '../StartupTimelineScreen';

// AppHeader はウィンドウ操作の IPC やギャラリーの状態に依存するため、この画面の検証から外す
vi.mock('../../AppHeader', () => ({
  AppHeader: () => <header />,
}));

const stats = {
  photos: 8900,
  worlds: 312,
  people: 1204,
  months: [
    { month: '2025-01', count: 40 },
    { month: '2025-03', count: 120 },
  ],
};

const sectorTones = (): [string | undefined, string | undefined][] =>
  [
    ...screen
      .getByTestId('startup-rings')
      .querySelectorAll<SVGPathElement>('path[data-month]'),
  ].map((path) => [path.dataset.month, path.dataset.tone]);

const monthsWithTone = (tone: string): (string | undefined)[] =>
  sectorTones()
    .filter(([, t]) => t === tone)
    .map(([month]) => month);

describe('StartupTimelineScreen', () => {
  beforeEach(() => {
    useI18n.setState({ language: 'ja' });
  });

  it('初回起動では写真を年ごとに並べる見出しを出し、統計が届く前は累計の文を出さない', () => {
    render(
      <StartupTimelineScreen
        runStage="photo_index"
        overallProgress={42}
        details={null}
        syncMode="full"
        isFirstLaunch
        stats={null}
        currentMonth="2025-04"
      />,
    );
    expect(screen.getByTestId('startup-headline').textContent).toBe(
      'これまでの写真を、年ごとに並べています',
    );
    expect(screen.getByTestId('startup-summary').textContent).toBe('');
  });

  it('差分読み込みでは前回からの写真を足す見出しと、累計の文を出す', () => {
    render(
      <StartupTimelineScreen
        runStage="log_append"
        overallProgress={10}
        details={{ current: 12, total: 128, unit: 'files' }}
        syncMode="incremental"
        isFirstLaunch={false}
        stats={stats}
        currentMonth="2025-04"
      />,
    );
    expect(screen.getByTestId('startup-headline').textContent).toBe(
      '前回からの写真を足しています',
    );
    expect(screen.getByTestId('startup-summary').textContent).toBe(
      '312 のワールドで、1,204 人と撮った 8,900 枚',
    );
    expect(screen.getByTestId('progress-detail').textContent).toBe(
      '12 / 128 ファイル',
    );
    // 処理中の撮影月が無いときは、写真がある最も新しい年を中央に出し、月は出さない
    expect(screen.getByTestId('startup-center-year').textContent).toBe('2025');
    expect(screen.queryByTestId('startup-center-month')).toBeNull();
  });

  it('全件の読み直しでは読み直しの見出しを出す', () => {
    render(
      <StartupTimelineScreen
        runStage="log_load"
        overallProgress={30}
        details={null}
        syncMode="full"
        isFirstLaunch={false}
        stats={stats}
        currentMonth="2025-04"
      />,
    );
    expect(screen.getByTestId('startup-headline').textContent).toBe(
      '写真とログを読み直しています',
    );
  });

  it('起動種別が分かる前は中立の見出しと、今年の空の輪を 1 周だけ出す', () => {
    render(
      <StartupTimelineScreen
        runStage="database_sync"
        overallProgress={3}
        details={null}
        syncMode={null}
        isFirstLaunch={null}
        stats={null}
        currentMonth="2025-04"
      />,
    );
    expect(screen.getByTestId('startup-headline').textContent).toBe(
      'アルバムを準備しています',
    );
    const tones = sectorTones();
    expect(tones).toHaveLength(12);
    expect(tones.slice(0, 4).every(([, t]) => t === 'empty')).toBe(true);
    expect(tones.slice(4).every(([, t]) => t === 'future')).toBe(true);
    expect(screen.getByTestId('startup-center-year').textContent).toBe('2025');
  });

  it('写真インデックス中は処理中の撮影月の区画を強調し、中央にその年と月を出す', () => {
    render(
      <StartupTimelineScreen
        runStage="photo_index"
        overallProgress={60}
        details={{
          current: 160,
          total: 400,
          unit: 'photos',
          currentItem: '2025-03',
        }}
        syncMode="full"
        isFirstLaunch
        stats={stats}
        currentMonth="2025-04"
      />,
    );
    expect(monthsWithTone('current')).toEqual(['2025-03']);
    expect(monthsWithTone('counted')).toEqual(['2025-01']);
    expect(screen.getAllByTestId('startup-current-outline')).toHaveLength(1);
    expect(screen.getByTestId('startup-center-year').textContent).toBe('2025');
    expect(screen.getByTestId('startup-center-month').textContent).toBe('3月');
    expect(screen.getByTestId('progress-detail').textContent).toBe(
      '2025年3月の写真　160 / 400 枚',
    );
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(
      '60',
    );
  });

  it('完了したら準備ができた旨を出し、件数の説明と強調は消す', () => {
    render(
      <StartupTimelineScreen
        runStage="completed"
        overallProgress={100}
        details={{
          current: 400,
          total: 400,
          unit: 'photos',
          currentItem: '2025-03',
        }}
        syncMode="incremental"
        isFirstLaunch={false}
        stats={stats}
        currentMonth="2025-04"
      />,
    );
    expect(screen.getByTestId('progress-message').textContent).toBe(
      '準備ができました',
    );
    expect(screen.getByTestId('progress-detail').textContent).toBe('');
    expect(monthsWithTone('current')).toEqual([]);
  });

  it('読み上げ対象はフェーズ名だけで、割合・件数・累計はライブリージョンに含めない', () => {
    render(
      <StartupTimelineScreen
        runStage="photo_index"
        overallProgress={60}
        details={{ current: 160, total: 400, unit: 'photos' }}
        syncMode="full"
        isFirstLaunch
        stats={stats}
        currentMonth="2025-04"
      />,
    );
    const status = screen.getByRole('status');
    expect(status).toBe(screen.getByTestId('progress-message'));
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.contains(screen.getByTestId('progress-percent'))).toBe(false);
    expect(status.contains(screen.getByTestId('progress-detail'))).toBe(false);
    expect(status.contains(screen.getByTestId('startup-summary'))).toBe(false);
    // 図は 1 枚の画像として名前だけを読み上げる
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      '年ごとの輪に並べた、撮影月ごとの写真の枚数',
    );
  });

  it('英語では文の順序を英語に合わせる', () => {
    useI18n.setState({ language: 'en' });
    render(
      <StartupTimelineScreen
        runStage="photo_index"
        overallProgress={60}
        details={{
          current: 160,
          total: 400,
          unit: 'photos',
          currentItem: '2025-03',
        }}
        syncMode="full"
        isFirstLaunch
        stats={stats}
        currentMonth="2025-04"
      />,
    );
    expect(screen.getByTestId('startup-headline').textContent).toBe(
      'Arranging your photos year by year',
    );
    expect(screen.getByTestId('startup-summary').textContent).toBe(
      '8,900 photos taken with 1,204 people across 312 worlds',
    );
    expect(screen.getByTestId('startup-center-month').textContent).toBe('Mar');
  });

  it('今月より後の撮影月を処理している間は今月の区画を強調する', () => {
    render(
      <StartupTimelineScreen
        runStage="photo_index"
        overallProgress={60}
        details={{
          current: 1,
          total: 2,
          unit: 'photos',
          currentItem: '2099-12',
        }}
        syncMode="full"
        isFirstLaunch
        stats={{
          ...stats,
          months: [...stats.months, { month: '2099-12', count: 1 }],
        }}
        currentMonth="2025-04"
      />,
    );
    expect(monthsWithTone('current')).toEqual(['2025-04']);
    expect(screen.getByTestId('startup-center-year').textContent).toBe('2025');
  });

  it('2017-01 より前の撮影月を処理している間は最も内側の輪の 1 月を強調する', () => {
    render(
      <StartupTimelineScreen
        runStage="photo_index"
        overallProgress={60}
        details={{
          current: 1,
          total: 2,
          unit: 'photos',
          currentItem: '1970-01',
        }}
        syncMode="full"
        isFirstLaunch
        stats={{
          ...stats,
          months: [{ month: '1970-01', count: 1 }, ...stats.months],
        }}
        currentMonth="2025-04"
      />,
    );
    const tones = sectorTones();
    expect(tones.at(0)).toEqual(['2017-01', 'current']);
    // 2017 年から 2025 年までの 9 周
    expect(tones).toHaveLength(9 * 12);
  });
});
