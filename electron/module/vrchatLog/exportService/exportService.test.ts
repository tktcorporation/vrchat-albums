import { promises as fs } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VRChatLogStoreFilePath } from '../model';
import { exportLogStore } from './exportService';

// fs をモック
vi.mock('fs', () => ({
  promises: {
    copyFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(''),
  },
}));

// logStorageManager をモック
vi.mock('../fileHandlers/logStorageManager', () => ({
  getLogStoreFilePathsInRange: vi.fn().mockResolvedValue([]),
}));

import { getLogStoreFilePathsInRange } from '../fileHandlers/logStorageManager';

const createMockFilePath = (
  filePath: string,
  yearMonth: string | null,
): VRChatLogStoreFilePath =>
  ({
    value: filePath,
    getYearMonth: () => yearMonth,
  }) as unknown as VRChatLogStoreFilePath;

describe('exportService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.copyFile).mockResolvedValue(undefined);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockResolvedValue('');
  });

  describe('exportLogStore', () => {
    it('logStoreファイルをコピーしてエクスポートできる', async () => {
      const mockFiles = [
        createMockFilePath(
          '/app/logStore/2023-10/logStore-2023-10.txt',
          '2023-10',
        ),
      ];
      vi.mocked(getLogStoreFilePathsInRange).mockResolvedValue(mockFiles);
      vi.mocked(fs.readFile).mockResolvedValue('line1\nline2\nline3\n');

      const result = await exportLogStore({
        startDate: new Date('2023-10-01T00:00:00'),
        endDate: new Date('2023-10-31T23:59:59'),
        outputBasePath: '/test/exports',
      });

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      expect(result.value.exportedFiles).toHaveLength(1);
      expect(result.value.exportedFiles[0]).toMatch(
        /vrchat-albums-export_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/,
      );
      expect(result.value.exportedFiles[0]).toContain('2023-10');
      expect(result.value.exportedFiles[0]).toContain('logStore-2023-10.txt');
      expect(result.value.totalLogLines).toBe(3);

      // fs.copyFile が呼ばれたことを確認
      expect(fs.copyFile).toHaveBeenCalledTimes(1);
      expect(fs.mkdir).toHaveBeenCalledTimes(1);
    });

    it('複数月のファイルをエクスポートできる', async () => {
      const mockFiles = [
        createMockFilePath(
          '/app/logStore/2023-09/logStore-2023-09.txt',
          '2023-09',
        ),
        createMockFilePath(
          '/app/logStore/2023-10/logStore-2023-10.txt',
          '2023-10',
        ),
      ];
      vi.mocked(getLogStoreFilePathsInRange).mockResolvedValue(mockFiles);
      vi.mocked(fs.readFile).mockResolvedValue('line1\nline2\n');

      const result = await exportLogStore({
        startDate: new Date('2023-09-01T00:00:00'),
        endDate: new Date('2023-10-31T23:59:59'),
        outputBasePath: '/test/exports',
      });

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      expect(result.value.exportedFiles).toHaveLength(2);
      expect(
        result.value.exportedFiles.some(
          (p: string) =>
            p.includes('2023-09') && p.includes('logStore-2023-09.txt'),
        ),
      ).toBe(true);
      expect(
        result.value.exportedFiles.some(
          (p: string) =>
            p.includes('2023-10') && p.includes('logStore-2023-10.txt'),
        ),
      ).toBe(true);
      expect(result.value.totalLogLines).toBe(4); // 2行 × 2ファイル

      expect(fs.copyFile).toHaveBeenCalledTimes(2);
      expect(fs.mkdir).toHaveBeenCalledTimes(2);
    });

    it('ファイルが存在しない場合は空の結果を返す', async () => {
      vi.mocked(getLogStoreFilePathsInRange).mockResolvedValue([]);

      const result = await exportLogStore({
        startDate: new Date('2023-10-01T00:00:00'),
        endDate: new Date('2023-10-31T23:59:59'),
      });

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      expect(result.value.exportedFiles).toHaveLength(0);
      expect(result.value.totalLogLines).toBe(0);

      expect(fs.copyFile).not.toHaveBeenCalled();
      expect(fs.mkdir).not.toHaveBeenCalled();
    });

    it('全期間指定（日付なし）でエクスポートできる', async () => {
      const mockFiles = [
        createMockFilePath(
          '/app/logStore/2023-10/logStore-2023-10.txt',
          '2023-10',
        ),
      ];
      vi.mocked(getLogStoreFilePathsInRange).mockResolvedValue(mockFiles);
      vi.mocked(fs.readFile).mockResolvedValue('line1\nline2\nline3\n');

      const result = await exportLogStore({
        outputBasePath: '/test/exports',
      });

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      expect(result.value.exportedFiles).toHaveLength(1);
      expect(result.value.totalLogLines).toBe(3);

      // getLogStoreFilePathsInRange が呼ばれたことを確認
      expect(getLogStoreFilePathsInRange).toHaveBeenCalledWith(
        expect.any(Date),
        expect.any(Date),
      );
    });

    it('コピーエラーが発生した場合はエラー結果を返す', async () => {
      const mockFiles = [
        createMockFilePath(
          '/app/logStore/2023-10/logStore-2023-10.txt',
          '2023-10',
        ),
      ];
      vi.mocked(getLogStoreFilePathsInRange).mockResolvedValue(mockFiles);
      vi.mocked(fs.copyFile).mockRejectedValue(new Error('Copy error'));

      const result = await exportLogStore({
        startDate: new Date('2023-10-01T00:00:00'),
        endDate: new Date('2023-10-31T23:59:59'),
      });

      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;

      expect(result.error.type).toBe('FILE_COPY_FAILED');
      expect(result.error.message).toBe('Copy error');
    });

    it('行数カウントでエラーが発生した場合はエラー結果を返す', async () => {
      const mockFiles = [
        createMockFilePath(
          '/app/logStore/2023-10/logStore-2023-10.txt',
          '2023-10',
        ),
      ];
      vi.mocked(getLogStoreFilePathsInRange).mockResolvedValue(mockFiles);
      vi.mocked(fs.readFile).mockRejectedValue(new Error('Read error'));

      const result = await exportLogStore({
        startDate: new Date('2023-10-01T00:00:00'),
        endDate: new Date('2023-10-31T23:59:59'),
      });

      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;

      expect(result.error.type).toBe('FILE_READ_FAILED');
      expect(result.error.message).toBe('Read error');
    });

    it('レガシーファイル（yearMonth=null）はルートに配置される', async () => {
      const mockFiles = [
        createMockFilePath('/app/logStore/logStore.txt', null),
      ];
      vi.mocked(getLogStoreFilePathsInRange).mockResolvedValue(mockFiles);
      vi.mocked(fs.readFile).mockResolvedValue('line1\n');

      const result = await exportLogStore({
        outputBasePath: '/test/exports',
      });

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      expect(result.value.exportedFiles).toHaveLength(1);
      // レガシーファイルは年月サブディレクトリなしで配置
      expect(result.value.exportedFiles[0]).toContain('logStore.txt');
      expect(result.value.exportedFiles[0]).toMatch(
        /vrchat-albums-export_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/,
      );
    });
  });
});
