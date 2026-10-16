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

describe('StartupTimelineScreen', () => {
  beforeEach(() => {
    useI18n.setState({ language: 'ja' });
  });

  it('初回起動では記録をさかのぼる見出しを出す', () => {
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
    expect(screen.getByTestId('startup-eyebrow').textContent).toBe(
      'はじめての読み込み',
    );
    expect(screen.getByTestId('startup-headline').textContent).toBe(
      'あなたの VRChat の記録を、\nさかのぼって集めています',
    );
    // 統計が届く前は 0 を出す
    expect(screen.getByTestId('startup-counter-photos').textContent).toBe('0');
  });

  it('差分読み込みでは新しいものを取り込む見出しを出す', () => {
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
      '新しい写真とログを取り込んでいます',
    );
    expect(screen.getByTestId('startup-counter-photos').textContent).toBe(
      '8,900',
    );
    expect(screen.getByTestId('progress-detail').textContent).toBe(
      '12 / 128 ファイル',
    );
  });

  it('起動種別が分かる前は中立の見出しを出す', () => {
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
    // 月が無くても棒グラフの枠だけは出る
    expect(
      screen
        .getByTestId('startup-month-chart')
        .querySelectorAll('[data-month]'),
    ).toHaveLength(0);
  });

  it('写真インデックス中は処理中の撮影月の棒を強調する', () => {
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
    const chart = screen.getByTestId('startup-month-chart');
    const tones = [...chart.querySelectorAll<HTMLElement>('[data-month]')].map(
      (bar) => [bar.dataset.month, bar.dataset.tone],
    );
    expect(tones).toEqual([
      ['2025-01', 'counted'],
      ['2025-02', 'empty'],
      ['2025-03', 'current'],
      ['2025-04', 'empty'],
    ]);
    expect(screen.getByTestId('progress-detail').textContent).toBe(
      '2025年3月の写真 · 160 / 400 枚',
    );
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(
      '60',
    );
  });

  it('完了したら準備ができた旨を出し、件数の説明は消す', () => {
    render(
      <StartupTimelineScreen
        runStage="completed"
        overallProgress={100}
        details={{ current: 400, total: 400, unit: 'photos' }}
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
  });

  it('読み上げ対象はフェーズ名だけで、割合と件数はライブリージョンに含めない', () => {
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
  });
});
