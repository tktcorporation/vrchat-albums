import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DataExport from './DataExport';

// trpcのモック
const mockMutate = vi.fn();
const _mockQuery = vi.fn();

vi.mock('@/trpc', () => ({
  trpcClient: {
    electronUtil: {
      getDownloadsPath: {
        query: () => Promise.resolve('/home/user/Downloads'),
      },
      openGetDirDialog: {
        query: () => Promise.resolve('/selected/path'),
      },
    },
  },
  trpcReact: {
    vrchatLog: {
      exportLogStoreData: {
        useMutation: () => ({
          mutate: mockMutate,
          isLoading: false,
        }),
      },
    },
  },
}));

// toast hookのモック
const mockToast = vi.fn();
vi.mock('../../hooks/use-toast', () => ({
  useToast: () => ({
    toast: mockToast,
  }),
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('DataExport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('デフォルトで全期間が選択されている', () => {
    render(<DataExport />, { wrapper: createWrapper() });

    const allTimeButton = screen.getByRole('button', { name: '全期間' });
    const recent3MonthsButton = screen.getByRole('button', {
      name: '過去3ヶ月',
    });
    const customButton = screen.getByRole('button', { name: 'カスタム期間' });

    // ボタンが存在することを確認
    expect(allTimeButton).toBeDefined();
    expect(recent3MonthsButton).toBeDefined();
    expect(customButton).toBeDefined();
  });

  it('全期間選択時は日付入力が表示されない', () => {
    render(<DataExport />, { wrapper: createWrapper() });

    // 全期間選択時は日付入力が表示されない
    expect(screen.queryByLabelText(/開始日/)).toBeNull();
    expect(screen.queryByLabelText(/終了日/)).toBeNull();
  });

  it('カスタム期間を選択すると日付入力が表示される', async () => {
    render(<DataExport />, { wrapper: createWrapper() });

    const customButton = screen.getByRole('button', { name: 'カスタム期間' });
    fireEvent.click(customButton);

    const startDateInput = screen.getByLabelText(/開始日/);
    const endDateInput = screen.getByLabelText(/終了日/);

    expect(startDateInput).toBeDefined();
    expect(endDateInput).toBeDefined();
  });

  it('全期間選択時はエクスポートボタンが有効', () => {
    render(<DataExport />, { wrapper: createWrapper() });

    const exportButton = screen.getByRole('button', {
      name: 'エクスポート開始',
    });
    expect((exportButton as HTMLButtonElement).disabled).toBe(false);
  });

  it('カスタム期間指定時に日付が未入力の場合はエクスポートボタンが無効', async () => {
    render(<DataExport />, { wrapper: createWrapper() });

    // カスタム期間を選択
    const customButton = screen.getByRole('button', { name: 'カスタム期間' });
    fireEvent.click(customButton);

    // 日付が未入力のまま
    const exportButton = screen.getByRole('button', {
      name: 'エクスポート開始',
    });
    expect((exportButton as HTMLButtonElement).disabled).toBe(true);
  });

  it('全期間エクスポート時にローカルタイム処理なしで呼び出される', async () => {
    render(<DataExport />, { wrapper: createWrapper() });

    // useEffect完了を待つ - outputPathが設定されるまで待機
    await waitFor(
      () => {
        const outputPathInput = screen.getByLabelText(/出力先ディレクトリ/);
        expect((outputPathInput as HTMLInputElement).value).toBe(
          '/home/user/Downloads',
        );
      },
      { timeout: 3000 },
    );

    const exportButton = screen.getByRole('button', {
      name: 'エクスポート開始',
    });
    fireEvent.click(exportButton);

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          outputPath: '/home/user/Downloads',
        }),
      );
    });
  });

  it('カスタム期間エクスポート時にローカルタイムとして処理される', async () => {
    render(<DataExport />, { wrapper: createWrapper() });

    // useEffectの完了を待つ - outputPathが設定されるまで待機
    await waitFor(
      () => {
        const outputPathInput = screen.getByLabelText(/出力先ディレクトリ/);
        expect((outputPathInput as HTMLInputElement).value).toBe(
          '/home/user/Downloads',
        );
      },
      { timeout: 3000 },
    );

    // カスタム期間を選択
    const customButton = screen.getByRole('button', { name: 'カスタム期間' });
    fireEvent.click(customButton);

    // 特定の日付を設定
    const startDateInput = screen.getByLabelText(/開始日/);
    const endDateInput = screen.getByLabelText(/終了日/);

    fireEvent.change(startDateInput, { target: { value: '2023-10-08' } });
    fireEvent.change(endDateInput, { target: { value: '2023-10-09' } });

    const exportButton = screen.getByRole('button', {
      name: 'エクスポート開始',
    });
    fireEvent.click(exportButton);

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          startDate: new Date('2023-10-08T00:00:00'), // ローカルタイム開始
          endDate: new Date('2023-10-09T23:59:59.999'), // ローカルタイム終了
          outputPath: '/home/user/Downloads',
        }),
      );
    });
  });

  it('カスタム期間指定時に開始日が終了日以降の場合はエラーメッセージが表示される', async () => {
    render(<DataExport />, { wrapper: createWrapper() });

    // useEffectの完了を待つ - outputPathが設定されるまで待機
    await waitFor(
      () => {
        const outputPathInput = screen.getByLabelText(/出力先ディレクトリ/);
        expect((outputPathInput as HTMLInputElement).value).toBe(
          '/home/user/Downloads',
        );
      },
      { timeout: 3000 },
    );

    // カスタム期間を選択
    const customButton = screen.getByRole('button', { name: 'カスタム期間' });
    fireEvent.click(customButton);

    // 無効な日付範囲を設定
    const startDateInput = screen.getByLabelText(/開始日/);
    const endDateInput = screen.getByLabelText(/終了日/);

    fireEvent.change(startDateInput, { target: { value: '2023-10-09' } });
    fireEvent.change(endDateInput, { target: { value: '2023-10-08' } });

    const exportButton = screen.getByRole('button', {
      name: 'エクスポート開始',
    });
    fireEvent.click(exportButton);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: '入力エラー',
        description: '開始日は終了日より前の日付を指定してください',
        variant: 'destructive',
      });
    });

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('全期間ボタンを選択すると日付入力が非表示になる', async () => {
    render(<DataExport />, { wrapper: createWrapper() });

    // まずカスタム期間を選択
    const customButton = screen.getByRole('button', { name: 'カスタム期間' });
    fireEvent.click(customButton);

    // 日付入力が表示されることを確認
    expect(screen.getByLabelText(/開始日/)).toBeDefined();

    // 全期間ボタンをクリック
    const allTimeButton = screen.getByRole('button', { name: '全期間' });
    fireEvent.click(allTimeButton);

    // 日付入力が非表示になることを確認
    expect(screen.queryByLabelText(/開始日/)).toBeNull();
  });

  it('過去3ヶ月エクスポート時に日付範囲付きで呼び出される', async () => {
    render(<DataExport />, { wrapper: createWrapper() });

    // useEffect完了を待つ - outputPathが設定されるまで待機
    await waitFor(
      () => {
        const outputPathInput = screen.getByLabelText(/出力先ディレクトリ/);
        expect((outputPathInput as HTMLInputElement).value).toBe(
          '/home/user/Downloads',
        );
      },
      { timeout: 3000 },
    );

    // 過去3ヶ月を選択
    const recent3MonthsButton = screen.getByRole('button', {
      name: '過去3ヶ月',
    });
    fireEvent.click(recent3MonthsButton);

    const exportButton = screen.getByRole('button', {
      name: 'エクスポート開始',
    });
    fireEvent.click(exportButton);

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          startDate: expect.any(Date),
          endDate: expect.any(Date),
          outputPath: '/home/user/Downloads',
        }),
      );
    });
  });
});
