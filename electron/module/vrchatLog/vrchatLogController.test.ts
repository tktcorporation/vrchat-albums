import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportResult } from './exportService/exportService';
import * as exportService from './exportService/exportService';
import { vrchatLogRouter } from './vrchatLogController';

// tRPCコンテキストのモック
const createMockContext = () => ({
  req: {},
  res: {},
});

// exportServiceをモック
vi.mock('./exportService/exportService', () => ({
  exportLogStore: vi.fn(),
}));

// logger をモック
vi.mock('./../../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// syncLogsをモック
vi.mock('../../logSync/service', () => ({
  syncLogs: vi.fn(),
  LOG_SYNC_MODE: {
    FULL: 'FULL',
    INCREMENTAL: 'INCREMENTAL',
  },
}));

// その他必要なモジュールをモック
vi.mock('./../vrchatLogFileDir/service');
vi.mock('./../vrchatWorldJoinLog/service');
vi.mock('./service');

// eventEmitter をモック
vi.mock('./../../trpc', () => ({
  eventEmitter: {
    emit: vi.fn(),
  },
  procedure: {
    input: vi.fn().mockReturnThis(),
    mutation: vi.fn().mockImplementation((handler) => handler),
    query: vi.fn().mockImplementation((handler) => handler),
  },
  router: vi.fn().mockImplementation((routes) => routes),
}));

describe('vrchatLogController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('exportLogStoreData', () => {
    it('全期間指定でエクスポートが実行される', async () => {
      const mockExportResult: ExportResult = {
        exportedFiles: ['/path/to/export/logStore-2023-10.txt'],
        totalLogLines: 100,
        exportStartTime: new Date('2023-10-08T10:00:00Z'),
        exportEndTime: new Date('2023-10-08T10:05:00Z'),
        manifestPath: '/path/to/export/export-manifest.json',
      };

      vi.mocked(exportService.exportLogStore).mockResolvedValue(
        ok(mockExportResult),
      );

      const router = vrchatLogRouter();
      const mutation = router.exportLogStoreData;

      const result = await mutation({
        input: {
          outputPath: '/custom/path',
        },
        ctx: createMockContext(),
        path: 'exportLogStoreData',
        type: 'mutation',
        getRawInput: async () => ({ outputPath: '/custom/path' }),
        signal: new AbortController().signal,
      });

      expect(result).toEqual(mockExportResult);
      expect(exportService.exportLogStore).toHaveBeenCalledWith({
        startDate: undefined,
        endDate: undefined,
        outputBasePath: '/custom/path',
      });
    });

    it('期間指定でエクスポートが実行される（ローカルタイム処理）', async () => {
      const mockExportResult: ExportResult = {
        exportedFiles: ['/path/to/export/logStore-2023-10.txt'],
        totalLogLines: 50,
        exportStartTime: new Date('2023-10-08T10:00:00Z'),
        exportEndTime: new Date('2023-10-08T10:03:00Z'),
        manifestPath: '/path/to/export/export-manifest.json',
      };

      vi.mocked(exportService.exportLogStore).mockResolvedValue(
        ok(mockExportResult),
      );

      const router = vrchatLogRouter();
      const mutation = router.exportLogStoreData;

      // フロントエンドから送られるローカルタイム
      const startDate = new Date('2023-10-08T00:00:00'); // ローカルタイム開始
      const endDate = new Date('2023-10-08T23:59:59.999'); // ローカルタイム終了

      const result = await mutation({
        input: {
          startDate,
          endDate,
          outputPath: '/custom/path',
        },
        ctx: createMockContext(),
        path: 'exportLogStoreData',
        type: 'mutation',
        getRawInput: async () => ({
          startDate,
          endDate,
          outputPath: '/custom/path',
        }),
        signal: new AbortController().signal,
      });

      expect(result).toEqual(mockExportResult);
      expect(exportService.exportLogStore).toHaveBeenCalledWith({
        startDate,
        endDate,
        outputBasePath: '/custom/path',
      });
    });

    it('エクスポートエラー時に適切に例外がスローされる', async () => {
      const exportError = new Error('Export failed: Database connection error');
      vi.mocked(exportService.exportLogStore).mockRejectedValue(exportError);

      const router = vrchatLogRouter();
      const mutation = router.exportLogStoreData;

      await expect(
        mutation({
          input: {
            startDate: new Date('2023-10-08T00:00:00'),
            endDate: new Date('2023-10-08T23:59:59'),
          },
          ctx: createMockContext(),
          path: 'exportLogStoreData',
          type: 'mutation',
          getRawInput: async () => ({
            startDate: new Date('2023-10-08T00:00:00'),
            endDate: new Date('2023-10-08T23:59:59'),
          }),
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow('Export failed: Database connection error');
    });
  });

  describe('exportLogStore (no DB dependency)', () => {
    it('期間指定なしでエクスポートが呼ばれる', async () => {
      const mockExportResult: ExportResult = {
        exportedFiles: [],
        totalLogLines: 0,
        exportStartTime: new Date(),
        exportEndTime: new Date(),
        manifestPath: '',
      };

      vi.mocked(exportService.exportLogStore).mockResolvedValue(
        ok(mockExportResult),
      );

      const router = vrchatLogRouter();
      const mutation = router.exportLogStoreData;

      await mutation({
        input: {},
        ctx: createMockContext(),
        path: 'exportLogStoreData',
        type: 'mutation',
        getRawInput: async () => ({}),
        signal: new AbortController().signal,
      });

      // exportLogStoreが期間指定なしで呼ばれることを確認
      expect(exportService.exportLogStore).toHaveBeenCalledWith({
        startDate: undefined,
        endDate: undefined,
        outputBasePath: undefined,
      });
    });
  });
});
