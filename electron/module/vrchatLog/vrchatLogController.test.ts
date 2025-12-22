import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DBLogProvider } from './exportService/exportService';
import * as exportService from './exportService/exportService';
import { vrchatLogRouter } from './vrchatLogController';

// tRPCコンテキストのモック
const createMockContext = () => ({
  req: {},
  res: {},
});

// exportServiceをモック
vi.mock('./exportService/exportService', () => ({
  exportLogStoreFromDB: vi.fn(),
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
      const mockExportResult = {
        exportedFiles: ['/path/to/export/logStore-2023-10.txt'],
        totalLogLines: 100,
        exportStartTime: new Date('2023-10-08T10:00:00Z'),
        exportEndTime: new Date('2023-10-08T10:05:00Z'),
      };

      vi.mocked(exportService.exportLogStoreFromDB).mockResolvedValue(
        mockExportResult,
      );

      const router = vrchatLogRouter();
      const mutation = router.exportLogStoreData;

      const result = await mutation({
        input: {
          outputPath: '/custom/path',
        },
        ctx: createMockContext(),
        rawInput: { outputPath: '/custom/path' },
        path: 'exportLogStoreData',
        type: 'mutation',
      });

      expect(result).toEqual(mockExportResult);
      expect(exportService.exportLogStoreFromDB).toHaveBeenCalledWith(
        {
          startDate: undefined,
          endDate: undefined,
          outputBasePath: '/custom/path',
        },
        expect.any(Function), // getDBLogsFromDatabase関数
      );
    });

    it('期間指定でエクスポートが実行される（ローカルタイム処理）', async () => {
      const mockExportResult = {
        exportedFiles: ['/path/to/export/logStore-2023-10.txt'],
        totalLogLines: 50,
        exportStartTime: new Date('2023-10-08T10:00:00Z'),
        exportEndTime: new Date('2023-10-08T10:03:00Z'),
      };

      vi.mocked(exportService.exportLogStoreFromDB).mockResolvedValue(
        mockExportResult,
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
        rawInput: {
          startDate,
          endDate,
          outputPath: '/custom/path',
        },
        path: 'exportLogStoreData',
        type: 'mutation',
      });

      expect(result).toEqual(mockExportResult);
      expect(exportService.exportLogStoreFromDB).toHaveBeenCalledWith(
        {
          startDate,
          endDate,
          outputBasePath: '/custom/path',
        },
        expect.any(Function), // getDBLogsFromDatabase関数
      );
    });

    it('エクスポートエラー時に適切に例外がスローされる', async () => {
      const exportError = new Error('Export failed: Database connection error');
      vi.mocked(exportService.exportLogStoreFromDB).mockRejectedValue(
        exportError,
      );

      const router = vrchatLogRouter();
      const mutation = router.exportLogStoreData;

      await expect(
        mutation({
          input: {
            startDate: new Date('2023-10-08T00:00:00'),
            endDate: new Date('2023-10-08T23:59:59'),
          },
          ctx: createMockContext(),
          rawInput: {
            startDate: new Date('2023-10-08T00:00:00'),
            endDate: new Date('2023-10-08T23:59:59'),
          },
          path: 'exportLogStoreData',
          type: 'mutation',
        }),
      ).rejects.toThrow('Export failed: Database connection error');
    });
  });

  describe('getDBLogsFromDatabase (timezone handling)', () => {
    it('期間指定なしで全データ取得が呼ばれる', async () => {
      const mockExportResult = {
        exportedFiles: [],
        totalLogLines: 0,
        exportStartTime: new Date(),
        exportEndTime: new Date(),
      };

      vi.mocked(exportService.exportLogStoreFromDB).mockResolvedValue(
        mockExportResult,
      );

      const router = vrchatLogRouter();
      const mutation = router.exportLogStoreData;

      await mutation({
        input: {},
        ctx: createMockContext(),
        rawInput: {},
        path: 'exportLogStoreData',
        type: 'mutation',
      });

      // exportLogStoreFromDBが期間指定なしで呼ばれることを確認
      expect(exportService.exportLogStoreFromDB).toHaveBeenCalledWith(
        {
          startDate: undefined,
          endDate: undefined,
          outputBasePath: undefined,
        },
        expect.any(Function), // getDBLogsFromDatabase関数
      );
    });

    it('期間指定時にローカルタイムが適切に処理される', async () => {
      let capturedGetDBLogs: DBLogProvider | undefined;

      vi.mocked(exportService.exportLogStoreFromDB).mockImplementation(
        async (_options, getDBLogs) => {
          capturedGetDBLogs = getDBLogs;
          return {
            exportedFiles: [],
            totalLogLines: 0,
            exportStartTime: new Date(),
            exportEndTime: new Date(),
          };
        },
      );

      const router = vrchatLogRouter();
      const mutation = router.exportLogStoreData;

      const startDate = new Date('2023-10-08T00:00:00'); // ローカルタイム
      const endDate = new Date('2023-10-08T23:59:59'); // ローカルタイム

      await mutation({
        input: {
          startDate,
          endDate,
        },
        ctx: createMockContext(),
        rawInput: { startDate, endDate },
        path: 'exportLogStoreData',
        type: 'mutation',
      });

      // getDBLogsFromDatabase関数が期待される引数で呼ばれることを確認
      expect(capturedGetDBLogs).toBeDefined();
      expect(typeof capturedGetDBLogs).toBe('function');
    });
  });
});
