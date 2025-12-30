import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ExportLogStoreOptions,
  exportLogStoreFromDB,
  getLogStoreExportPath,
} from './exportService';

// fs.writeFile をモック
vi.mock('fs', () => ({
  promises: {
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('exportService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // モック関数のデフォルト戻り値を再設定
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
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

      const exportResult = await exportLogStoreFromDB(options, mockGetDBLogs);

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
      expect(result.totalLogLines).toBe(3); // worldJoin=2行 + playerJoin=1行

      // ファイル書き込みが呼ばれたことを確認
      expect(fs.writeFile).toHaveBeenCalledTimes(1);
      // ディレクトリ作成が呼ばれたことを確認（エクスポート日時フォルダを含む）
      expect(fs.mkdir).toHaveBeenCalledTimes(1);
      const mkdirCallPath = String(vi.mocked(fs.mkdir).mock.calls[0][0]);
      expect(mkdirCallPath).toMatch(
        /vrchat-albums-export_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/,
      );
      expect(mkdirCallPath).toContain('2023-10');
      // パスの構造を確認
      const pathParts = String(mkdirCallPath).split(path.sep);
      expect(pathParts).toContain('test');
      expect(pathParts).toContain('exports');
      expect(pathParts[pathParts.length - 1]).toBe('2023-10');
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

      const exportResult = await exportLogStoreFromDB(options, mockGetDBLogs);

      expect(exportResult.isOk()).toBe(true);
      if (!exportResult.isOk()) return;

      const result = exportResult.value;
      expect(result.exportedFiles).toHaveLength(2);
      // エクスポート日時フォルダが含まれることを確認
      for (const filePath of result.exportedFiles) {
        expect(filePath).toMatch(
          /vrchat-albums-export_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/,
        );
      }
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
      expect(result.totalLogLines).toBe(4); // 各worldJoin=2行ずつ

      // 2つのファイルが作成されたことを確認
      expect(fs.writeFile).toHaveBeenCalledTimes(2);
      // ディレクトリ作成が呼ばれたことを確認（エクスポート日時フォルダを含む）
      expect(fs.mkdir).toHaveBeenCalledTimes(2);
      const mkdirCalls = vi.mocked(fs.mkdir).mock.calls;

      // 1つ目のディレクトリパスを確認
      const mkdirPath1 = String(mkdirCalls[0][0]);
      expect(mkdirPath1).toMatch(
        /vrchat-albums-export_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/,
      );
      expect(mkdirPath1).toContain('2023-09');
      const pathParts1 = String(mkdirPath1).split(path.sep);
      expect(pathParts1[pathParts1.length - 1]).toBe('2023-09');

      // 2つ目のディレクトリパスを確認
      const mkdirPath2 = String(mkdirCalls[1][0]);
      expect(mkdirPath2).toMatch(
        /vrchat-albums-export_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/,
      );
      expect(mkdirPath2).toContain('2023-10');
      const pathParts2 = String(mkdirPath2).split(path.sep);
      expect(pathParts2[pathParts2.length - 1]).toBe('2023-10');
    });

    it('データが存在しない場合は空の結果を返す', async () => {
      const options: ExportLogStoreOptions = {
        startDate: new Date('2023-10-08T00:00:00'),
        endDate: new Date('2023-10-08T23:59:59'),
      };

      const mockGetDBLogs = vi.fn().mockResolvedValue([]);

      const exportResult = await exportLogStoreFromDB(options, mockGetDBLogs);

      expect(exportResult.isOk()).toBe(true);
      if (!exportResult.isOk()) return;

      const result = exportResult.value;
      expect(result.exportedFiles).toHaveLength(0);
      expect(result.totalLogLines).toBe(0);

      // ファイル操作が呼ばれていないことを確認
      expect(fs.writeFile).not.toHaveBeenCalled();
      expect(fs.mkdir).not.toHaveBeenCalled();
    });

    it('全期間指定（日付なし）でエクスポートできる', async () => {
      const options: ExportLogStoreOptions = {
        outputBasePath: '/test/exports',
      };

      const mockGetDBLogs = vi.fn().mockResolvedValue([
        {
          type: 'worldJoin' as const,
          record: {
            id: 'world-1',
            worldId: 'wrld_12345678-1234-1234-1234-123456789abc',
            worldName: 'All Time World',
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
            playerName: 'AllTimePlayer',
            playerId: 'usr_12345678-1234-1234-1234-123456789abc',
            joinDateTime: new Date('2023-10-08T15:31:00'),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      ]);

      const exportResult = await exportLogStoreFromDB(options, mockGetDBLogs);

      expect(exportResult.isOk()).toBe(true);
      if (!exportResult.isOk()) return;

      const result = exportResult.value;
      expect(result.exportedFiles).toHaveLength(1);
      expect(result.totalLogLines).toBe(3); // worldJoin=2行 + playerJoin=1行

      // DB取得関数が日付パラメータなしで呼ばれることを確認
      expect(mockGetDBLogs).toHaveBeenCalledWith(undefined, undefined);

      // ファイル書き込みが呼ばれたことを確認
      expect(fs.writeFile).toHaveBeenCalledTimes(1);
      expect(fs.mkdir).toHaveBeenCalledTimes(1);
    });

    it('ローカルタイムからUTCへの変換を適切に処理する', async () => {
      // フロントエンドから送られるローカルタイムを模擬
      // '2023-10-08T00:00:00' (ローカルタイム開始)
      // '2023-10-08T23:59:59.999' (ローカルタイム終了)
      const localStartTime = new Date('2023-10-08T00:00:00');
      const localEndTime = new Date('2023-10-08T23:59:59.999');

      const options: ExportLogStoreOptions = {
        startDate: localStartTime,
        endDate: localEndTime,
        outputBasePath: '/test/exports',
      };

      const mockGetDBLogs = vi.fn().mockResolvedValue([
        {
          type: 'worldJoin' as const,
          record: {
            id: 'world-1',
            worldId: 'wrld_12345678-1234-1234-1234-123456789abc',
            worldName: 'Timezone Test World',
            worldInstanceId: '12345',
            joinDateTime: new Date('2023-10-08T15:30:45Z'), // UTC時刻でDB保存
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      ]);

      const exportResult = await exportLogStoreFromDB(options, mockGetDBLogs);

      expect(exportResult.isOk()).toBe(true);
      if (!exportResult.isOk()) return;

      const result = exportResult.value;
      expect(result.exportedFiles).toHaveLength(1);
      expect(result.totalLogLines).toBe(2); // worldJoin=2行

      // DB取得関数がローカルタイム（JavaScript Date）で呼ばれることを確認
      expect(mockGetDBLogs).toHaveBeenCalledWith(localStartTime, localEndTime);

      // 実際のDB比較ではJavaScriptがローカルタイムとUTCを自動変換するため、
      // ここではパラメータが正しく渡されることのみ確認
    });

    it('DBエラーが発生した場合は適切に処理される', async () => {
      const options: ExportLogStoreOptions = {
        startDate: new Date('2023-10-08T00:00:00'),
        endDate: new Date('2023-10-08T23:59:59'),
      };

      const mockGetDBLogs = vi
        .fn()
        .mockRejectedValue(new Error('Database error'));

      // DBエラーはそのままthrowされる（予期しないエラー）
      await expect(
        exportLogStoreFromDB(options, mockGetDBLogs),
      ).rejects.toThrow('Database error');
    });

    it('書き込みエラーが発生した場合はエラー結果を返す', async () => {
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

      const exportResult = await exportLogStoreFromDB(options, mockGetDBLogs);

      expect(exportResult.isErr()).toBe(true);
      if (!exportResult.isErr()) return;

      expect(exportResult.error.type).toBe('FILE_WRITE_FAILED');
      expect(exportResult.error.message).toBe('Write error');
    });
  });
});
