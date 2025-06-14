import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as datefns from 'date-fns';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ExportLogStoreOptions,
  exportLogStoreFromDB,
  getLogStoreExportPath,
} from './exportService';

// fs.writeFile をモック
vi.mock('fs', () => ({
  promises: {
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  },
}));

describe('exportService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getLogStoreExportPath', () => {
    it('日付からlogStore形式のパスを生成できる', () => {
      const date = new Date('2023-10-08T15:30:45');
      const result = getLogStoreExportPath(date, '/path/to/logStore');

      expect(result).toBe('/path/to/logStore/2023-10/logStore-2023-10.txt');
    });

    it('異なる年月でも正しいパスを生成できる', () => {
      const date = new Date('2024-01-15T09:15:30');
      const result = getLogStoreExportPath(date, '/exports');

      expect(result).toBe('/exports/2024-01/logStore-2024-01.txt');
    });

    it('デフォルトパスが使用される', () => {
      const date = new Date('2023-10-08T15:30:45');
      const result = getLogStoreExportPath(date);

      expect(result).toContain('logStore/2023-10/logStore-2023-10.txt');
    });
  });

  describe('exportLogStoreFromDB', () => {
    it('日付範囲を指定してエクスポートできる', async () => {
      const options: ExportLogStoreOptions = {
        startDate: new Date('2023-10-08T00:00:00'),
        endDate: new Date('2023-10-08T23:59:59'),
        outputBasePath: '/test/exports',
      };

      // DB取得処理をモック（実際の実装では外部から注入される）
      const mockGetDBLogs = vi.fn().mockResolvedValue([
        {
          type: 'worldJoin' as const,
          record: {
            id: 'world-1',
            worldId: 'wrld_12345678-1234-1234-1234-123456789abc',
            worldName: 'Test World',
            worldInstanceId: '12345',
            joinDateTime: new Date('2023-10-08T15:30:45'),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
        {
          type: 'playerJoin' as const,
          record: {
            id: 'player-1',
            playerName: 'TestPlayer',
            playerId: 'usr_12345678-1234-1234-1234-123456789abc',
            joinDateTime: new Date('2023-10-08T15:31:00'),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      ]);

      const result = await exportLogStoreFromDB(options, mockGetDBLogs);

      expect(result.exportedFiles).toHaveLength(1);
      expect(result.exportedFiles[0]).toBe(
        '/test/exports/2023-10/logStore-2023-10.txt',
      );
      expect(result.totalLogLines).toBe(3); // worldJoin=2行 + playerJoin=1行

      // ファイル書き込みが呼ばれたことを確認
      expect(fs.writeFile).toHaveBeenCalledTimes(1);
      expect(fs.mkdir).toHaveBeenCalledWith('/test/exports/2023-10', {
        recursive: true,
      });
    });

    it('複数月にまたがるデータを月別ファイルにエクスポートできる', async () => {
      const options: ExportLogStoreOptions = {
        startDate: new Date('2023-09-30T00:00:00'),
        endDate: new Date('2023-10-01T23:59:59'),
        outputBasePath: '/test/exports',
      };

      const mockGetDBLogs = vi.fn().mockResolvedValue([
        {
          type: 'worldJoin' as const,
          record: {
            id: 'world-1',
            worldId: 'wrld_12345678-1234-1234-1234-123456789abc',
            worldName: 'September World',
            worldInstanceId: '12345',
            joinDateTime: new Date('2023-09-30T23:30:00'),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
        {
          type: 'worldJoin' as const,
          record: {
            id: 'world-2',
            worldId: 'wrld_87654321-4321-4321-4321-abcdefabcdef',
            worldName: 'October World',
            worldInstanceId: '54321',
            joinDateTime: new Date('2023-10-01T01:00:00'),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      ]);

      const result = await exportLogStoreFromDB(options, mockGetDBLogs);

      expect(result.exportedFiles).toHaveLength(2);
      expect(result.exportedFiles).toContain(
        '/test/exports/2023-09/logStore-2023-09.txt',
      );
      expect(result.exportedFiles).toContain(
        '/test/exports/2023-10/logStore-2023-10.txt',
      );
      expect(result.totalLogLines).toBe(4); // 各worldJoin=2行ずつ

      // 2つのファイルが作成されたことを確認
      expect(fs.writeFile).toHaveBeenCalledTimes(2);
      expect(fs.mkdir).toHaveBeenCalledWith('/test/exports/2023-09', {
        recursive: true,
      });
      expect(fs.mkdir).toHaveBeenCalledWith('/test/exports/2023-10', {
        recursive: true,
      });
    });

    it('データが存在しない場合は空の結果を返す', async () => {
      const options: ExportLogStoreOptions = {
        startDate: new Date('2023-10-08T00:00:00'),
        endDate: new Date('2023-10-08T23:59:59'),
      };

      const mockGetDBLogs = vi.fn().mockResolvedValue([]);

      const result = await exportLogStoreFromDB(options, mockGetDBLogs);

      expect(result.exportedFiles).toHaveLength(0);
      expect(result.totalLogLines).toBe(0);

      // ファイル操作が呼ばれていないことを確認
      expect(fs.writeFile).not.toHaveBeenCalled();
      expect(fs.mkdir).not.toHaveBeenCalled();
    });

    it('エラーが発生した場合は適切に処理される', async () => {
      const options: ExportLogStoreOptions = {
        startDate: new Date('2023-10-08T00:00:00'),
        endDate: new Date('2023-10-08T23:59:59'),
      };

      const mockGetDBLogs = vi
        .fn()
        .mockRejectedValue(new Error('Database error'));

      await expect(
        exportLogStoreFromDB(options, mockGetDBLogs),
      ).rejects.toThrow('Database error');
    });

    it('書き込みエラーが発生した場合は適切に処理される', async () => {
      const options: ExportLogStoreOptions = {
        startDate: new Date('2023-10-08T00:00:00'),
        endDate: new Date('2023-10-08T23:59:59'),
      };

      const mockGetDBLogs = vi.fn().mockResolvedValue([
        {
          type: 'worldJoin' as const,
          record: {
            id: 'world-1',
            worldId: 'wrld_12345678-1234-1234-1234-123456789abc',
            worldName: 'Test World',
            worldInstanceId: '12345',
            joinDateTime: new Date('2023-10-08T15:30:45'),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      ]);

      // ファイル書き込みでエラーを発生させる
      vi.mocked(fs.writeFile).mockRejectedValue(new Error('Write error'));

      await expect(
        exportLogStoreFromDB(options, mockGetDBLogs),
      ).rejects.toThrow('Write error');
    });
  });
});
