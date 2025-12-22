import type { Dirent } from 'node:fs';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogRecord } from '../converters/dbToLogStore';
import type { ExportResult } from '../exportService/exportService';
import * as exportServiceModule from '../exportService/exportService';
import type { DBLogProvider, ImportBackupMetadata } from './backupService';
import { backupService } from './backupService';

// モックの設定
vi.mock('node:fs', () => ({
  promises: {
    access: vi.fn(),
    readdir: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  },
}));

vi.mock('../../../lib/wrappedApp', () => ({
  getAppUserDataPath: vi.fn(() => '/mocked/userData'),
}));

vi.mock('../exportService/exportService', () => ({
  exportLogStoreFromDB: vi.fn(),
}));

// Helper function to create a mock Dirent
// const _createMockDirent = (name: string, isDir: boolean) =>
//   ({
//     name,
//     isDirectory: () => isDir,
//     isFile: () => !isDir,
//     isBlockDevice: () => false,
//     isCharacterDevice: () => false,
//     isFIFO: () => false,
//     isSocket: () => false,
//     isSymbolicLink: () => false,
//     path: '',
//     parentPath: '',
//   }) as unknown as Dirent<Buffer>;

describe('backupService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createPreImportBackup', () => {
    const mockGetDBLogs: DBLogProvider = async () => {
      return [] as LogRecord[];
    };

    it('エクスポート機能を使用してバックアップを作成できる', async () => {
      const mockTimestamp = new Date('2023-12-01T14:30:45');
      vi.setSystemTime(mockTimestamp);

      const mockExportResult: ExportResult = {
        totalLogLines: 100,
        exportedFiles: [
          path.join(
            '/mocked/userData/backups',
            'vrchat-albums-export_2023-12-01_14-30-45',
            '2023-11',
            'logStore-2023-11.txt',
          ),
        ],
        exportStartTime: mockTimestamp,
        exportEndTime: mockTimestamp,
      };

      vi.mocked(exportServiceModule.exportLogStoreFromDB).mockResolvedValue(
        mockExportResult,
      );
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);

      const result = await backupService.createPreImportBackup(mockGetDBLogs);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const backup = result.value;
        expect(backup.id).toBe('backup_20231201_143045');
        expect(backup.backupTimestamp).toEqual(mockTimestamp);
        expect(backup.exportFolderPath).toBe(
          'vrchat-albums-export_2023-12-01_14-30-45',
        );
        expect(backup.status).toBe('completed');
        expect(backup.totalLogLines).toBe(100);
        expect(backup.exportedFiles).toEqual(mockExportResult.exportedFiles);
      }

      // エクスポート関数が正しいパラメータで呼ばれたことを確認
      expect(exportServiceModule.exportLogStoreFromDB).toHaveBeenCalledWith(
        {
          outputBasePath: path.join('/mocked/userData', 'backups'),
        },
        mockGetDBLogs,
      );

      // メタデータファイルが保存されたことを確認
      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join(
          '/mocked/userData/backups',
          'vrchat-albums-export_2023-12-01_14-30-45',
          'backup-metadata.json',
        ),
        expect.any(String),
      );
    });

    it('エクスポートに失敗した場合はエラーを返す', async () => {
      vi.mocked(exportServiceModule.exportLogStoreFromDB).mockRejectedValue(
        new Error('Export failed'),
      );

      const result = await backupService.createPreImportBackup(mockGetDBLogs);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Export failed');
      }
    });
  });

  describe('updateBackupMetadata', () => {
    it('バックアップメタデータを更新できる', async () => {
      const metadata: ImportBackupMetadata = {
        id: 'backup_20231201_143045',
        backupTimestamp: new Date('2023-12-01T14:30:45'),
        exportFolderPath: 'vrchat-albums-export_2023-12-01_14-30-45',
        sourceFiles: ['/path/to/import.txt'],
        status: 'completed',
        importTimestamp: new Date('2023-12-01T14:35:00'),
        totalLogLines: 100,
        exportedFiles: ['logStore-2023-11.txt'],
      };

      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const result = await backupService.updateBackupMetadata(metadata);

      expect(result.isOk()).toBe(true);
      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join(
          '/mocked/userData/backups',
          'vrchat-albums-export_2023-12-01_14-30-45',
          'backup-metadata.json',
        ),
        JSON.stringify(metadata, null, 2),
      );
    });
  });

  describe('getBackupHistory', () => {
    it('バックアップディレクトリが存在しない場合は空配列を返す', async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

      const result = await backupService.getBackupHistory();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual([]);
      }
    });

    it('バックアップ履歴を取得できる', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue([
        {
          name: 'vrchat-albums-export_2023-12-01_14-30-45',
          isDirectory: () => true,
          isFile: () => false,
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isFIFO: () => false,
          isSocket: () => false,
          isSymbolicLink: () => false,
          path: '',
          parentPath: '',
        } as unknown as Dirent<Buffer>,
        {
          name: 'vrchat-albums-export_2023-12-02_10-20-30',
          isDirectory: () => true,
          isFile: () => false,
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isFIFO: () => false,
          isSocket: () => false,
          isSymbolicLink: () => false,
          path: '',
          parentPath: '',
        } as unknown as Dirent<Buffer>,
        {
          name: 'not-a-backup',
          isDirectory: () => true,
          isFile: () => false,
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isFIFO: () => false,
          isSocket: () => false,
          isSymbolicLink: () => false,
          path: '',
          parentPath: '',
        } as unknown as Dirent<Buffer>,
      ] as Dirent<Buffer>[]);

      const metadata1: ImportBackupMetadata = {
        id: 'backup_20231201_143045',
        backupTimestamp: new Date('2023-12-01T14:30:45'),
        exportFolderPath: 'vrchat-albums-export_2023-12-01_14-30-45',
        sourceFiles: [],
        status: 'completed',
        importTimestamp: new Date('2023-12-01T14:30:45'),
        totalLogLines: 100,
        exportedFiles: [],
      };

      const metadata2: ImportBackupMetadata = {
        id: 'backup_20231202_102030',
        backupTimestamp: new Date('2023-12-02T10:20:30'),
        exportFolderPath: 'vrchat-albums-export_2023-12-02_10-20-30',
        sourceFiles: [],
        status: 'rolled_back',
        importTimestamp: new Date('2023-12-02T10:20:30'),
        totalLogLines: 200,
        exportedFiles: [],
      };

      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(JSON.stringify(metadata1))
        .mockResolvedValueOnce(JSON.stringify(metadata2));

      const result = await backupService.getBackupHistory();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toHaveLength(2);
        // 降順ソート（新しいものが先頭）
        expect(result.value[0].id).toBe('backup_20231202_102030');
        expect(result.value[1].id).toBe('backup_20231201_143045');
      }
    });

    it('メタデータ読み込みに失敗したバックアップはスキップする', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue([
        {
          name: 'vrchat-albums-export_2023-12-01_14-30-45',
          isDirectory: () => true,
          isFile: () => false,
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isFIFO: () => false,
          isSocket: () => false,
          isSymbolicLink: () => false,
          path: '',
          parentPath: '',
        } as unknown as Dirent<Buffer>,
      ] as Dirent<Buffer>[]);

      vi.mocked(fs.readFile).mockRejectedValue(new Error('File not found'));

      const result = await backupService.getBackupHistory();

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual([]);
      }
    });
  });

  describe('getBackup', () => {
    it('指定されたIDのバックアップを取得できる', async () => {
      const targetId = 'backup_20231201_143045';
      const metadata: ImportBackupMetadata = {
        id: targetId,
        backupTimestamp: new Date('2023-12-01T14:30:45'),
        exportFolderPath: 'vrchat-albums-export_2023-12-01_14-30-45',
        sourceFiles: [],
        status: 'completed',
        importTimestamp: new Date('2023-12-01T14:30:45'),
        totalLogLines: 100,
        exportedFiles: [],
      };

      // getBackupHistoryのモック設定
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue([
        {
          name: 'vrchat-albums-export_2023-12-01_14-30-45',
          isDirectory: () => true,
          isFile: () => false,
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isFIFO: () => false,
          isSocket: () => false,
          isSymbolicLink: () => false,
          path: '',
          parentPath: '',
        } as unknown as Dirent<Buffer>,
      ] as Dirent<Buffer>[]);
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(metadata));

      const result = await backupService.getBackup(targetId);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.id).toBe(targetId);
      }
    });

    it('バックアップが見つからない場合はエラーを返す', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue([]);

      const result = await backupService.getBackup('non-existent-id');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('バックアップが見つかりません');
      }
    });
  });
});
