import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VRChatLogStoreFilePath } from '../model';
import { exportLogStore, getExportErrorMessage } from './exportService';

// fs をモック
vi.mock('fs', () => ({
  promises: {
    copyFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(''),
    stat: vi.fn().mockResolvedValue({ size: 100 }),
    writeFile: vi.fn().mockResolvedValue(undefined),
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
    vi.mocked(fs.stat).mockResolvedValue({ size: 100 } as never);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
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

      // マニフェストが書き出されたことを確認
      expect(fs.writeFile).toHaveBeenCalledTimes(1);
      expect(result.value.manifestPath).toContain('export-manifest.json');
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
      expect(result.value.manifestPath).toBe('');

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
      if (result.error.type !== 'FILE_COPY_FAILED') return;
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
      if (result.error.type !== 'FILE_READ_FAILED') return;
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

    it('コピー後のファイルサイズ不一致でFILE_VERIFY_FAILEDエラーを返す', async () => {
      const mockFiles = [
        createMockFilePath(
          '/app/logStore/2023-10/logStore-2023-10.txt',
          '2023-10',
        ),
      ];
      vi.mocked(getLogStoreFilePathsInRange).mockResolvedValue(mockFiles);
      // stat: ソースとコピー先でサイズが異なる
      vi.mocked(fs.stat)
        .mockResolvedValueOnce({ size: 100 } as never) // src
        .mockResolvedValueOnce({ size: 50 } as never); // dest

      const result = await exportLogStore({
        startDate: new Date('2023-10-01T00:00:00'),
        endDate: new Date('2023-10-31T23:59:59'),
        outputBasePath: '/test/exports',
      });

      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;

      expect(result.error.type).toBe('FILE_VERIFY_FAILED');
      if (result.error.type !== 'FILE_VERIFY_FAILED') return;
      expect(result.error.expectedSize).toBe(100);
      expect(result.error.actualSize).toBe(50);
    });

    it('splitファイル（タイムスタンプ付き）をエクスポートできる', async () => {
      const mockFiles = [
        createMockFilePath(
          '/app/logStore/2023-10/logStore-2023-10.txt',
          '2023-10',
        ),
        createMockFilePath(
          '/app/logStore/2023-10/logStore-2023-10-20231015120000.txt',
          '2023-10',
        ),
      ];
      vi.mocked(getLogStoreFilePathsInRange).mockResolvedValue(mockFiles);
      vi.mocked(fs.readFile).mockResolvedValue('line1\nline2\n');

      const result = await exportLogStore({
        startDate: new Date('2023-10-01T00:00:00'),
        endDate: new Date('2023-10-31T23:59:59'),
        outputBasePath: '/test/exports',
      });

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      expect(result.value.exportedFiles).toHaveLength(2);
      expect(
        result.value.exportedFiles.some((p) =>
          p.includes('logStore-2023-10.txt'),
        ),
      ).toBe(true);
      expect(
        result.value.exportedFiles.some((p) =>
          p.includes('logStore-2023-10-20231015120000.txt'),
        ),
      ).toBe(true);
      expect(result.value.totalLogLines).toBe(4); // 2行 × 2ファイル
    });

    it('年跨ぎの複数月ファイルをエクスポートできる', async () => {
      const mockFiles = [
        createMockFilePath(
          '/app/logStore/2023-12/logStore-2023-12.txt',
          '2023-12',
        ),
        createMockFilePath(
          '/app/logStore/2024-01/logStore-2024-01.txt',
          '2024-01',
        ),
      ];
      vi.mocked(getLogStoreFilePathsInRange).mockResolvedValue(mockFiles);
      vi.mocked(fs.readFile).mockResolvedValue('line1\nline2\n');

      const result = await exportLogStore({
        startDate: new Date('2023-12-01T00:00:00'),
        endDate: new Date('2024-01-31T23:59:59'),
        outputBasePath: '/test/exports',
      });

      expect(result.isOk()).toBe(true);
      if (!result.isOk()) return;

      expect(result.value.exportedFiles).toHaveLength(2);
      expect(
        result.value.exportedFiles.some((p) => p.includes('2023-12')),
      ).toBe(true);
      expect(
        result.value.exportedFiles.some((p) => p.includes('2024-01')),
      ).toBe(true);
      expect(result.value.totalLogLines).toBe(4);
    });

    it('マニフェスト書き込み失敗でMANIFEST_WRITE_FAILEDエラーを返す', async () => {
      const mockFiles = [
        createMockFilePath(
          '/app/logStore/2023-10/logStore-2023-10.txt',
          '2023-10',
        ),
      ];
      vi.mocked(getLogStoreFilePathsInRange).mockResolvedValue(mockFiles);
      vi.mocked(fs.readFile).mockResolvedValue('line1\n');
      vi.mocked(fs.writeFile).mockRejectedValue(new Error('Disk full'));

      const result = await exportLogStore({
        startDate: new Date('2023-10-01T00:00:00'),
        endDate: new Date('2023-10-31T23:59:59'),
        outputBasePath: '/test/exports',
      });

      expect(result.isErr()).toBe(true);
      if (!result.isErr()) return;

      expect(result.error.type).toBe('MANIFEST_WRITE_FAILED');
      if (result.error.type !== 'MANIFEST_WRITE_FAILED') return;
      expect(result.error.message).toBe('Disk full');
    });

    it('マニフェストに正しいファイル情報が含まれる', async () => {
      const mockFiles = [
        createMockFilePath(
          '/app/logStore/2023-10/logStore-2023-10.txt',
          '2023-10',
        ),
      ];
      vi.mocked(getLogStoreFilePathsInRange).mockResolvedValue(mockFiles);
      vi.mocked(fs.readFile).mockResolvedValue('line1\nline2\nline3\n');
      vi.mocked(fs.stat).mockResolvedValue({ size: 42 } as never);

      const result = await exportLogStore({
        startDate: new Date('2023-10-01T00:00:00'),
        endDate: new Date('2023-10-31T23:59:59'),
        outputBasePath: '/test/exports',
      });

      expect(result.isOk()).toBe(true);

      // writeFile に渡されたマニフェスト内容を検証
      const writeFileCall = vi.mocked(fs.writeFile).mock.calls[0];
      const manifestContent = JSON.parse(writeFileCall[1] as string);

      expect(manifestContent.version).toBe(1);
      expect(manifestContent.status).toBe('completed');
      expect(manifestContent.totalLogLines).toBe(3);
      expect(manifestContent.files).toHaveLength(1);
      expect(manifestContent.files[0].relativePath).toBe(
        path.join('2023-10', 'logStore-2023-10.txt'),
      );
      expect(manifestContent.files[0].sizeBytes).toBe(42);
      expect(manifestContent.exportDateTime).toBeDefined();
    });
  });

  describe('getExportErrorMessage', () => {
    it('FILE_VERIFY_FAILEDのエラーメッセージを返す', () => {
      const msg = getExportErrorMessage({
        type: 'FILE_VERIFY_FAILED',
        src: '/src/file.txt',
        dest: '/dest/file.txt',
        expectedSize: 100,
        actualSize: 50,
      });
      expect(msg).toContain('検証に失敗');
      expect(msg).toContain('100');
      expect(msg).toContain('50');
    });

    it('MANIFEST_WRITE_FAILEDのエラーメッセージを返す', () => {
      const msg = getExportErrorMessage({
        type: 'MANIFEST_WRITE_FAILED',
        path: '/test/manifest.json',
        message: 'Disk full',
      });
      expect(msg).toContain('マニフェスト');
      expect(msg).toContain('Disk full');
    });
  });
});
