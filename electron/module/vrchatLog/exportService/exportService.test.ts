import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ExportLogStoreOptions,
  exportLogStore,
  getLogStoreExportPath,
} from './exportService';

// logStorageManager をモック
vi.mock('../fileHandlers/logStorageManager', () => ({
  getLogStoreDir: vi.fn().mockReturnValue('/mock/logStore'),
  getLogStoreFilePathsInRange: vi.fn().mockResolvedValue([]),
}));

// fs をモック
vi.mock('fs', () => ({
  promises: {
    copyFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue('line1\nline2\nline3\n'),
  },
}));

import {
  getLogStoreDir,
  getLogStoreFilePathsInRange,
} from '../fileHandlers/logStorageManager';

describe('exportService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // モック関数のデフォルト戻り値を再設定
    vi.mocked(fs.copyFile).mockResolvedValue(undefined);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockResolvedValue('line1\nline2\nline3\n');
    vi.mocked(getLogStoreDir).mockReturnValue('/mock/logStore');
    vi.mocked(getLogStoreFilePathsInRange).mockResolvedValue([]);
  });

  describe('getLogStoreExportPath', () => {
    it('日付からlogStore形式のパスを生成できる', () => {
      const date = new Date('2023-10-08T15:30:45');
      const exportDateTime = new Date('2023-11-15T10:20:30');
      const result = getLogStoreExportPath(
        date,
        '/path/to/logStore',
        exportDateTime,
      );

      // クロスプラットフォーム対応: パス区切り文字を正規化
      const expectedPath = path.join(
        '/path/to/logStore',
        'vrchat-albums-export_2023-11-15_10-20-30',
        '2023-10',
        'logStore-2023-10.txt',
      );
      expect(result).toBe(expectedPath);
    });

    it('異なる年月でも正しいパスを生成できる', () => {
      const date = new Date('2024-01-15T09:15:30');
      const exportDateTime = new Date('2024-02-20T14:45:10');
      const result = getLogStoreExportPath(date, '/exports', exportDateTime);

      // クロスプラットフォーム対応: パス区切り文字を正規化
      const expectedPath = path.join(
        '/exports',
        'vrchat-albums-export_2024-02-20_14-45-10',
        '2024-01',
        'logStore-2024-01.txt',
      );
      expect(result).toBe(expectedPath);
    });

    it('デフォルトパスが使用される', () => {
      const date = new Date('2023-10-08T15:30:45');
      const result = getLogStoreExportPath(date);

      // エクスポート日時フォルダが含まれることを確認
      expect(result).toMatch(
        /vrchat-albums-export_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/,
      );

      // クロスプラットフォーム対応: パス区切り文字を正規化して確認
      const expectedPathPart = path.join('2023-10', 'logStore-2023-10.txt');
      expect(result).toContain(expectedPathPart);
    });
  });

  describe('exportLogStore', () => {
    it('logStoreファイルをコピーしてエクスポートできる', async () => {
      const mockFilePath = {
        value: '/mock/logStore/2023-10/logStore-2023-10.txt',
      };
      vi.mocked(getLogStoreFilePathsInRange).mockResolvedValue([
        mockFilePath as ReturnType<
          typeof import('../fileHandlers/logStorageManager').getLogStoreFilePathsInRange
        > extends Promise<infer T>
          ? T extends (infer U)[]
            ? U
            : never
          : never,
      ]);

      const options: ExportLogStoreOptions = {
        startDate: new Date('2023-10-08T00:00:00'),
        endDate: new Date('2023-10-08T23:59:59'),
        outputBasePath: '/test/exports',
      };

      const exportResult = await exportLogStore(options);

      expect(exportResult.isOk()).toBe(true);
      if (!exportResult.isOk()) return;

      const result = exportResult.value;
      expect(result.exportedFiles).toHaveLength(1);
      // エクスポート日時フォルダが含まれることを確認
      expect(result.exportedFiles[0]).toMatch(
        /vrchat-albums-export_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/,
      );
      expect(result.exportedFiles[0]).toContain('2023-10');
      expect(result.exportedFiles[0]).toContain('logStore-2023-10.txt');
      expect(result.totalLogLines).toBe(3); // モックファイルの行数

      // ファイルコピーが呼ばれたことを確認
      expect(fs.copyFile).toHaveBeenCalledTimes(1);
      // ディレクトリ作成が呼ばれたことを確認
      expect(fs.mkdir).toHaveBeenCalledTimes(1);
    });

    it('複数月のファイルをエクスポートできる', async () => {
      const mockFiles = [
        { value: '/mock/logStore/2023-09/logStore-2023-09.txt' },
        { value: '/mock/logStore/2023-10/logStore-2023-10.txt' },
      ];
      vi.mocked(getLogStoreFilePathsInRange).mockResolvedValue(
        mockFiles as ReturnType<
          typeof import('../fileHandlers/logStorageManager').getLogStoreFilePathsInRange
        > extends Promise<infer T>
          ? T
          : never,
      );

      const options: ExportLogStoreOptions = {
        startDate: new Date('2023-09-30T00:00:00'),
        endDate: new Date('2023-10-01T23:59:59'),
        outputBasePath: '/test/exports',
      };

      const exportResult = await exportLogStore(options);

      expect(exportResult.isOk()).toBe(true);
      if (!exportResult.isOk()) return;

      const result = exportResult.value;
      expect(result.exportedFiles).toHaveLength(2);
      expect(
        result.exportedFiles.some(
          (p: string) =>
            p.includes('2023-09') && p.includes('logStore-2023-09.txt'),
        ),
      ).toBe(true);
      expect(
        result.exportedFiles.some(
          (p: string) =>
            p.includes('2023-10') && p.includes('logStore-2023-10.txt'),
        ),
      ).toBe(true);
      expect(result.totalLogLines).toBe(6); // 2ファイル × 3行

      // 2つのファイルがコピーされたことを確認
      expect(fs.copyFile).toHaveBeenCalledTimes(2);
      expect(fs.mkdir).toHaveBeenCalledTimes(2);
    });

    it('logStoreファイルが存在しない場合は空の結果を返す', async () => {
      vi.mocked(getLogStoreFilePathsInRange).mockResolvedValue([]);

      const options: ExportLogStoreOptions = {
        startDate: new Date('2023-10-08T00:00:00'),
        endDate: new Date('2023-10-08T23:59:59'),
      };

      const exportResult = await exportLogStore(options);

      expect(exportResult.isOk()).toBe(true);
      if (!exportResult.isOk()) return;

      const result = exportResult.value;
      expect(result.exportedFiles).toHaveLength(0);
      expect(result.totalLogLines).toBe(0);

      // ファイル操作が呼ばれていないことを確認
      expect(fs.copyFile).not.toHaveBeenCalled();
      expect(fs.mkdir).not.toHaveBeenCalled();
    });

    it('全期間指定（日付なし）でエクスポートできる', async () => {
      const mockFilePath = {
        value: '/mock/logStore/2023-10/logStore-2023-10.txt',
      };
      vi.mocked(getLogStoreFilePathsInRange).mockResolvedValue([
        mockFilePath as ReturnType<
          typeof import('../fileHandlers/logStorageManager').getLogStoreFilePathsInRange
        > extends Promise<infer T>
          ? T extends (infer U)[]
            ? U
            : never
          : never,
      ]);

      const options: ExportLogStoreOptions = {
        outputBasePath: '/test/exports',
      };

      const exportResult = await exportLogStore(options);

      expect(exportResult.isOk()).toBe(true);
      if (!exportResult.isOk()) return;

      const result = exportResult.value;
      expect(result.exportedFiles).toHaveLength(1);
      expect(result.totalLogLines).toBe(3);

      // ファイルコピーが呼ばれたことを確認
      expect(fs.copyFile).toHaveBeenCalledTimes(1);
      expect(fs.mkdir).toHaveBeenCalledTimes(1);
    });

    it('コピーエラーが発生した場合はエラー結果を返す', async () => {
      const mockFilePath = {
        value: '/mock/logStore/2023-10/logStore-2023-10.txt',
      };
      vi.mocked(getLogStoreFilePathsInRange).mockResolvedValue([
        mockFilePath as ReturnType<
          typeof import('../fileHandlers/logStorageManager').getLogStoreFilePathsInRange
        > extends Promise<infer T>
          ? T extends (infer U)[]
            ? U
            : never
          : never,
      ]);

      // ファイルコピーでエラーを発生させる
      vi.mocked(fs.copyFile).mockRejectedValue(new Error('Copy error'));

      const options: ExportLogStoreOptions = {
        startDate: new Date('2023-10-08T00:00:00'),
        endDate: new Date('2023-10-08T23:59:59'),
      };

      const exportResult = await exportLogStore(options);

      expect(exportResult.isErr()).toBe(true);
      if (!exportResult.isErr()) return;

      expect(exportResult.error.type).toBe('FILE_COPY_FAILED');
    });
  });
});
