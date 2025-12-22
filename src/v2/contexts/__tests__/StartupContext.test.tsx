import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StartupProvider, useStartup } from '../StartupContext';

// useStartupStageのモック
const mockUseStartupStage = {
  stages: { initialization: 'pending' },
  errorMessage: '',
  retryProcess: vi.fn(),
  completed: false,
  finished: false,
};

vi.mock('../../hooks/useStartUpStage', () => ({
  useStartupStage: vi.fn(() => mockUseStartupStage),
}));

import { useStartupStage } from '../../hooks/useStartUpStage';

const mockUseStartupStageHook = useStartupStage as ReturnType<typeof vi.fn>;

// テスト用コンポーネント
const TestComponent = () => {
  const { stage, error, isReady, retry } = useStartup();

  return (
    <div>
      <div data-testid="stage">{stage}</div>
      <div data-testid="error">{error || 'no-error'}</div>
      <div data-testid="isReady">{isReady ? 'true' : 'false'}</div>
      <button type="button" data-testid="retry" onClick={retry}>
        Retry
      </button>
    </div>
  );
};

describe('StartupContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // デフォルトのモック状態をリセット
    mockUseStartupStage.stages = { initialization: 'pending' };
    mockUseStartupStage.errorMessage = '';
    mockUseStartupStage.completed = false;
    mockUseStartupStage.finished = false;

    mockUseStartupStageHook.mockReturnValue(mockUseStartupStage);
  });

  it('初期状態では idle stage を表示する', () => {
    render(
      <StartupProvider>
        <TestComponent />
      </StartupProvider>,
    );

    expect(screen.getByTestId('stage').textContent).toBe('idle');
    expect(screen.getByTestId('error').textContent).toBe('no-error');
    expect(screen.getByTestId('isReady').textContent).toBe('false');
  });

  it('initialization が inProgress の場合は syncing stage を表示する', () => {
    mockUseStartupStage.stages = { initialization: 'inProgress' };
    mockUseStartupStageHook.mockReturnValue(mockUseStartupStage);

    render(
      <StartupProvider>
        <TestComponent />
      </StartupProvider>,
    );

    expect(screen.getByTestId('stage').textContent).toBe('syncing');
    expect(screen.getByTestId('isReady').textContent).toBe('false');
  });

  it('initialization が success の場合は ready stage を表示する', () => {
    mockUseStartupStage.stages = { initialization: 'success' };
    mockUseStartupStage.completed = true;
    mockUseStartupStageHook.mockReturnValue(mockUseStartupStage);

    render(
      <StartupProvider>
        <TestComponent />
      </StartupProvider>,
    );

    expect(screen.getByTestId('stage').textContent).toBe('ready');
    expect(screen.getByTestId('isReady').textContent).toBe('true');
  });

  it('initialization が error の場合は error stage を表示する', () => {
    mockUseStartupStage.stages = { initialization: 'error' };
    mockUseStartupStage.errorMessage = 'Test error message';
    mockUseStartupStageHook.mockReturnValue(mockUseStartupStage);

    render(
      <StartupProvider>
        <TestComponent />
      </StartupProvider>,
    );

    expect(screen.getByTestId('stage').textContent).toBe('error');
    expect(screen.getByTestId('error').textContent).toBe('Test error message');
    expect(screen.getByTestId('isReady').textContent).toBe('false');
  });

  it('LOG_DIRECTORY_ERROR の場合は適切にエラーメッセージを表示する', () => {
    mockUseStartupStage.stages = { initialization: 'error' };
    mockUseStartupStage.errorMessage =
      'LOG_DIRECTORY_ERROR: VRChatのログフォルダが見つかりません';
    mockUseStartupStageHook.mockReturnValue(mockUseStartupStage);

    render(
      <StartupProvider>
        <TestComponent />
      </StartupProvider>,
    );

    expect(screen.getByTestId('stage').textContent).toBe('error');
    expect(screen.getByTestId('error').textContent).toBe(
      'LOG_DIRECTORY_ERROR: VRChatのログフォルダが見つかりません',
    );
  });

  it('retry ボタンクリック時に retryProcess が呼ばれる', () => {
    render(
      <StartupProvider>
        <TestComponent />
      </StartupProvider>,
    );

    const retryButton = screen.getByTestId('retry');
    retryButton.click();

    expect(mockUseStartupStage.retryProcess).toHaveBeenCalledTimes(1);
  });

  it('useStartup を Provider 外で使用するとエラーになる', () => {
    // エラーログを抑制
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(<TestComponent />);
    }).toThrow('useStartup must be used within a StartupProvider');

    consoleSpy.mockRestore();
  });

  it.each([
    { initialization: 'pending' as const, expected: 'idle' },
    { initialization: 'inProgress' as const, expected: 'syncing' },
    { initialization: 'success' as const, expected: 'ready' },
    { initialization: 'error' as const, expected: 'error' },
  ])('$initialization ステージは $expected として表示される', ({
    initialization,
    expected,
  }) => {
    mockUseStartupStage.stages = { initialization };
    mockUseStartupStageHook.mockReturnValue(mockUseStartupStage);

    render(
      <StartupProvider>
        <TestComponent />
      </StartupProvider>,
    );

    expect(screen.getByTestId('stage').textContent).toBe(expected);
  });

  it('completed フラグが正しく反映される', () => {
    // 完了していない状態
    mockUseStartupStage.stages = { initialization: 'inProgress' };
    mockUseStartupStage.completed = false;
    mockUseStartupStageHook.mockReturnValue(mockUseStartupStage);

    const { rerender } = render(
      <StartupProvider>
        <TestComponent />
      </StartupProvider>,
    );

    expect(screen.getByTestId('isReady').textContent).toBe('false');

    // 完了状態に変更
    mockUseStartupStage.stages = { initialization: 'success' };
    mockUseStartupStage.completed = true;
    mockUseStartupStageHook.mockReturnValue(mockUseStartupStage);

    rerender(
      <StartupProvider>
        <TestComponent />
      </StartupProvider>,
    );

    expect(screen.getByTestId('isReady').textContent).toBe('true');
  });
});
