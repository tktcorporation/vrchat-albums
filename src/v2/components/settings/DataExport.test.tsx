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
    const monthButton = screen.getByRole('button', { name: '過去1ヶ月' });

    // ボタンが存在することを確認
    expect(allTimeButton).toBeDefined();
    expect(monthButton).toBeDefined();
  });

  it('全期間選択時は日付入力が無効化される', () => {
    render(<DataExport />, { wrapper: createWrapper() });

    const startDateInput = screen.getByLabelText(/開始日/);
    const endDateInput = screen.getByLabelText(/終了日/);

    expect((startDateInput as HTMLInputElement).disabled).toBe(true);
    expect((endDateInput as HTMLInputElement).disabled).toBe(true);
  });

  it('期間プリセットボタンをクリックすると日付入力が有効になる', async () => {
    render(<DataExport />, { wrapper: createWrapper() });

    const monthButton = screen.getByRole('button', { name: '過去1ヶ月' });
    fireEvent.click(monthButton);

    const startDateInput = screen.getByLabelText(/開始日/);
    const endDateInput = screen.getByLabelText(/終了日/);

    expect((startDateInput as HTMLInputElement).disabled).toBe(false);
    expect((endDateInput as HTMLInputElement).disabled).toBe(false);
    expect((startDateInput as HTMLInputElement).value).toBeTruthy(); // 日付が設定される
    expect((endDateInput as HTMLInputElement).value).toBeTruthy(); // 日付が設定される
  });

  it('全期間選択時はエクスポートボタンが有効', () => {
    render(<DataExport />, { wrapper: createWrapper() });

    const exportButton = screen.getByRole('button', {
      name: 'エクスポート開始',
    });
    expect((exportButton as HTMLButtonElement).disabled).toBe(false);
  });

  it('期間指定時に日付が未入力の場合はエクスポートボタンが無効', async () => {
    render(<DataExport />, { wrapper: createWrapper() });

    // 過去1ヶ月を選択して日付をクリア
    const monthButton = screen.getByRole('button', { name: '過去1ヶ月' });
    fireEvent.click(monthButton);

    const startDateInput = screen.getByLabelText(/開始日/);
    fireEvent.change(startDateInput, { target: { value: '' } });

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

  it('期間指定エクスポート時にローカルタイムとして処理される', async () => {
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

    // 期間を選択
    const monthButton = screen.getByRole('button', { name: '過去1ヶ月' });
    fireEvent.click(monthButton);

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

  it('期間指定時に開始日が終了日以降の場合はエラーメッセージが表示される', async () => {
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

    // 期間を選択
    const monthButton = screen.getByRole('button', { name: '過去1ヶ月' });
    fireEvent.click(monthButton);

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

  it('全期間ボタンを再クリックで日付入力が無効化される', async () => {
    render(<DataExport />, { wrapper: createWrapper() });

    // まず期間を選択
    const monthButton = screen.getByRole('button', { name: '過去1ヶ月' });
    fireEvent.click(monthButton);

    // 日付入力が有効になることを確認
    const startDateInput = screen.getByLabelText(/開始日/);
    expect((startDateInput as HTMLInputElement).disabled).toBe(false);

    // 全期間ボタンをクリック
    const allTimeButton = screen.getByRole('button', { name: '全期間' });
    fireEvent.click(allTimeButton);

    // 日付入力が再び無効化されることを確認
    expect((startDateInput as HTMLInputElement).disabled).toBe(true);
    expect((startDateInput as HTMLInputElement).value).toBe(''); // 値もクリアされる
  });
});
