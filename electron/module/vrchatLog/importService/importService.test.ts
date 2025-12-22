import type { Dirent, Stats } from 'node:fs';
import { promises as fs } from 'node:fs';
import * as neverthrow from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as logSyncModule from '../../logSync/service';
import type { DBLogProvider } from '../backupService/backupService';
import * as backupServiceModule from '../backupService/backupService';
import type { LogRecord } from '../converters/dbToLogStore';
import * as logStorageManagerModule from '../fileHandlers/logStorageManager';
import { importService } from './importService';

// モックの設定
vi.mock('fs', () => ({
  promises: {
    access: vi.fn(),
    stat: vi.fn(),
    readFile: vi.fn(),
    readdir: vi.fn(),
  },
}));

vi.mock('../backupService/backupService', () => ({
  backupService: {
    createPreImportBackup: vi.fn(),
    updateBackupMetadata: vi.fn(),
  },
}));

vi.mock('../fileHandlers/logStorageManager', () => ({
  appendLoglinesToFile: vi.fn(),
}));

vi.mock('../../logSync/service', () => ({
  LOG_SYNC_MODE: {
    FULL: 'full',
    INCREMENTAL: 'incremental',
  },
  syncLogs: vi.fn(),
}));

describe('importService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockGetDBLogs: DBLogProvider = async () => {
    return [] as LogRecord[];
  };

  describe('importLogStoreFiles', () => {
    it('ファイルをインポートできる', async () => {
      const filePaths = ['/path/to/logStore-2023-11.txt'];
      const mockBackup = {
        id: 'backup_20231201_143045',
        backupTimestamp: new Date(),
        exportFolderPath: 'export-folder',
        sourceFiles: [],
        status: 'completed' as const,
        importTimestamp: new Date(),
        totalLogLines: 0,
        exportedFiles: [],
      };

      // モックの設定
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.stat).mockResolvedValue({
        isFile: () => true,
        isDirectory: () => false,
      } as Stats);
      vi.mocked(fs.readFile).mockResolvedValue(
        '2023-10-08 18:57:27 Log        -  [Behaviour] Joining or Creating Room: Test World',
      );

      vi.mocked(
        backupServiceModule.backupService.createPreImportBackup,
      ).mockResolvedValue(neverthrow.ok(mockBackup));
      vi.mocked(
        backupServiceModule.backupService.updateBackupMetadata,
      ).mockResolvedValue(neverthrow.ok(undefined));
      vi.mocked(logStorageManagerModule.appendLoglinesToFile).mockResolvedValue(
        neverthrow.ok(undefined),
      );
      vi.mocked(logSyncModule.syncLogs).mockResolvedValue(
        neverthrow.ok({
          createdWorldJoinLogModelList: [],
          createdPlayerJoinLogModelList: [],
          createdPlayerLeaveLogModelList: [],
          createdVRChatPhotoPathModelList: [],
        }),
      );

      const result = await importService.importLogStoreFiles(
        filePaths,
        mockGetDBLogs,
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.success).toBe(true);
        expect(result.value.backup).toEqual(mockBackup);
        expect(result.value.importedData.totalLines).toBe(1);
        expect(result.value.importedData.processedFiles).toEqual(filePaths);
      }

      // バックアップが作成されたことを確認
      expect(
        backupServiceModule.backupService.createPreImportBackup,
      ).toHaveBeenCalledWith(mockGetDBLogs);

      // DB同期が実行されたことを確認
      expect(logSyncModule.syncLogs).toHaveBeenCalledWith('incremental');
    });

    it('ディレクトリをインポートできる', async () => {
      const dirPath = '/path/to/export-dir';
      const mockBackup = {
        id: 'backup_20231201_143045',
        backupTimestamp: new Date(),
        exportFolderPath: 'export-folder',
        sourceFiles: [],
        status: 'completed' as const,
        importTimestamp: new Date(),
        totalLogLines: 0,
        exportedFiles: [],
      };

      // ディレクトリ構造のモック
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.stat).mockImplementation(async (p) => {
        if (p === dirPath) {
          return { isFile: () => false, isDirectory: () => true } as Stats;
        }
        return { isFile: () => true, isDirectory: () => false } as Stats;
      });
      vi.mocked(fs.readdir).mockResolvedValue([
        {
          name: 'logStore-2023-11.txt',
          isFile: () => true,
          isDirectory: () => false,
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isFIFO: () => false,
          isSocket: () => false,
          isSymbolicLink: () => false,
          path: '',
          parentPath: '',
        },
        {
          name: 'other.txt',
          isFile: () => true,
          isDirectory: () => false,
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isFIFO: () => false,
          isSocket: () => false,
          isSymbolicLink: () => false,
          path: '',
          parentPath: '',
        },
      ] as unknown as Dirent<Buffer>[]);
      vi.mocked(fs.readFile).mockResolvedValue(
        '2023-10-08 18:57:27 Log        -  [Behaviour] Joining or Creating Room: Test World',
      );

      vi.mocked(
        backupServiceModule.backupService.createPreImportBackup,
      ).mockResolvedValue(neverthrow.ok(mockBackup));
      vi.mocked(
        backupServiceModule.backupService.updateBackupMetadata,
      ).mockResolvedValue(neverthrow.ok(undefined));
      vi.mocked(logStorageManagerModule.appendLoglinesToFile).mockResolvedValue(
        neverthrow.ok(undefined),
      );
      vi.mocked(logSyncModule.syncLogs).mockResolvedValue(
        neverthrow.ok({
          createdWorldJoinLogModelList: [],
          createdPlayerJoinLogModelList: [],
          createdPlayerLeaveLogModelList: [],
          createdVRChatPhotoPathModelList: [],
        }),
      );

      const result = await importService.importLogStoreFiles(
        [dirPath],
        mockGetDBLogs,
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.success).toBe(true);
        expect(result.value.importedData.totalLines).toBe(1);
        expect(result.value.importedData.processedFiles).toHaveLength(1);
        expect(result.value.importedData.processedFiles[0]).toContain(
          'logStore-2023-11.txt',
        );
      }
    });

    it('logStoreファイルが見つからない場合はエラーを返す', async () => {
      const filePaths = ['/path/to/nonexistent.txt'];

      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

      const result = await importService.importLogStoreFiles(
        filePaths,
        mockGetDBLogs,
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain(
          'インポート対象のlogStoreファイルが見つかりませんでした',
        );
      }
    });

    it('バックアップ作成に失敗した場合はエラーを返す', async () => {
      const filePaths = ['/path/to/logStore-2023-11.txt'];

      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.stat).mockResolvedValue({
        isFile: () => true,
        isDirectory: () => false,
      } as Stats);
      vi.mocked(
        backupServiceModule.backupService.createPreImportBackup,
      ).mockResolvedValue(neverthrow.err(new Error('Backup failed')));

      const result = await importService.importLogStoreFiles(
        filePaths,
        mockGetDBLogs,
      );

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Backup failed');
      }
    });
  });

  describe('collectLogStoreFiles (private)', () => {
    // プライベートメソッドのテストは統合テストで行うか、
    // importLogStoreFiles経由でテストする
    it('再帰的にlogStoreファイルを収集できることを確認', async () => {
      const paths = ['/path/to/dir', '/path/to/file.txt'];
      const mockBackup = {
        id: 'backup_20231201_143045',
        backupTimestamp: new Date(),
        exportFolderPath: 'export-folder',
        sourceFiles: [],
        status: 'completed' as const,
        importTimestamp: new Date(),
        totalLogLines: 0,
        exportedFiles: [],
      };

      // モックの設定
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.stat).mockImplementation(async (p) => {
        if (p === '/path/to/dir' || p.toString().includes('subdir')) {
          return { isFile: () => false, isDirectory: () => true } as Stats;
        }
        // file.txtはファイルだがlogStoreファイルではないのでスキップされる
        return { isFile: () => true, isDirectory: () => false } as Stats;
      });
      vi.mocked(fs.readdir).mockImplementation(async (dir) => {
        if (dir === '/path/to/dir') {
          return [
            {
              name: 'logStore-2023-11.txt',
              isFile: () => true,
              isDirectory: () => false,
            },
            { name: 'subdir', isFile: () => false, isDirectory: () => true },
          ] as unknown as Dirent<Buffer>[];
        }
        if (dir.toString().includes('subdir')) {
          return [
            {
              name: 'logStore-2023-12.txt',
              isFile: () => true,
              isDirectory: () => false,
            },
          ] as unknown as Dirent<Buffer>[];
        }
        return [];
      });
      vi.mocked(fs.readFile).mockResolvedValue(
        '2023-10-08 18:57:27 Log        -  [Behaviour] Joining or Creating Room: Test World',
      );

      vi.mocked(
        backupServiceModule.backupService.createPreImportBackup,
      ).mockResolvedValue(neverthrow.ok(mockBackup));
      vi.mocked(
        backupServiceModule.backupService.updateBackupMetadata,
      ).mockResolvedValue(neverthrow.ok(undefined));
      vi.mocked(logStorageManagerModule.appendLoglinesToFile).mockResolvedValue(
        neverthrow.ok(undefined),
      );
      vi.mocked(logSyncModule.syncLogs).mockResolvedValue(
        neverthrow.ok({
          createdWorldJoinLogModelList: [],
          createdPlayerJoinLogModelList: [],
          createdPlayerLeaveLogModelList: [],
          createdVRChatPhotoPathModelList: [],
        }),
      );

      const result = await importService.importLogStoreFiles(
        paths,
        mockGetDBLogs,
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // /path/to/dir内のlogStoreファイルのみが処理される
        // file.txtはlogStoreファイルではないのでスキップ
        // dir/logStore-2023-11.txt + dir/subdir/logStore-2023-12.txt = 2ファイル
        expect(result.value.importedData.processedFiles).toHaveLength(2);
        expect(result.value.importedData.totalLines).toBe(2);
      }
    });
  });

  describe('validateLogStoreFiles (private)', () => {
    // バリデーションエラーのテスト
    it('無効なログ形式のファイルでも警告のみで処理を継続する', async () => {
      const filePaths = ['/path/to/logStore-invalid.txt']; // logStoreファイル名にする
      const mockBackup = {
        id: 'backup_20231201_143045',
        backupTimestamp: new Date(),
        exportFolderPath: 'export-folder',
        sourceFiles: [],
        status: 'completed' as const,
        importTimestamp: new Date(),
        totalLogLines: 0,
        exportedFiles: [],
      };

      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.stat).mockResolvedValue({
        isFile: () => true,
        isDirectory: () => false,
      } as Stats);
      vi.mocked(fs.readFile).mockResolvedValue(
        'This is not a valid log line format\nAnother invalid line',
      );

      vi.mocked(
        backupServiceModule.backupService.createPreImportBackup,
      ).mockResolvedValue(neverthrow.ok(mockBackup));
      vi.mocked(
        backupServiceModule.backupService.updateBackupMetadata,
      ).mockResolvedValue(neverthrow.ok(undefined));
      vi.mocked(logStorageManagerModule.appendLoglinesToFile).mockResolvedValue(
        neverthrow.ok(undefined),
      );
      vi.mocked(logSyncModule.syncLogs).mockResolvedValue(
        neverthrow.ok({
          createdWorldJoinLogModelList: [],
          createdPlayerJoinLogModelList: [],
          createdPlayerLeaveLogModelList: [],
          createdVRChatPhotoPathModelList: [],
        }),
      );

      const result = await importService.importLogStoreFiles(
        filePaths,
        mockGetDBLogs,
      );

      // 処理自体は成功する（無効な行も含めて処理される）
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // 実際の動作に合わせて、totalLinesは2（無効でも行数としてカウント）
        expect(result.value.importedData.totalLines).toBe(2);
        expect(result.value.success).toBe(true);
      }
    });
  });

  describe('isLogStoreFile (private)', () => {
    // ファイル判定ロジックのテスト（統合的にテスト）
    it('logStore関連ファイルのみが処理される', async () => {
      const paths = ['/path/to/dir'];
      const mockBackup = {
        id: 'backup_20231201_143045',
        backupTimestamp: new Date(),
        exportFolderPath: 'export-folder',
        sourceFiles: [],
        status: 'completed' as const,
        importTimestamp: new Date(),
        totalLogLines: 0,
        exportedFiles: [],
      };

      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.stat).mockResolvedValue({
        isFile: () => false,
        isDirectory: () => true,
      } as Stats);
      vi.mocked(fs.readdir).mockResolvedValue([
        {
          name: 'logStore-2023-11.txt',
          isFile: () => true,
          isDirectory: () => false,
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isFIFO: () => false,
          isSocket: () => false,
          isSymbolicLink: () => false,
          path: '',
          parentPath: '',
        },
        {
          name: 'vrchat-albums-export_data.txt',
          isFile: () => true,
          isDirectory: () => false,
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isFIFO: () => false,
          isSocket: () => false,
          isSymbolicLink: () => false,
          path: '',
          parentPath: '',
        },
        {
          name: 'not-related.txt',
          isFile: () => true,
          isDirectory: () => false,
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isFIFO: () => false,
          isSocket: () => false,
          isSymbolicLink: () => false,
          path: '',
          parentPath: '',
        },
        {
          name: 'image.png',
          isFile: () => true,
          isDirectory: () => false,
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isFIFO: () => false,
          isSocket: () => false,
          isSymbolicLink: () => false,
          path: '',
          parentPath: '',
        },
      ] as unknown as Dirent<Buffer>[]);
      vi.mocked(fs.readFile).mockResolvedValue(
        '2023-10-08 18:57:27 Log        -  [Behaviour] Joining or Creating Room: Test World',
      );

      vi.mocked(
        backupServiceModule.backupService.createPreImportBackup,
      ).mockResolvedValue(neverthrow.ok(mockBackup));
      vi.mocked(
        backupServiceModule.backupService.updateBackupMetadata,
      ).mockResolvedValue(neverthrow.ok(undefined));
      vi.mocked(logStorageManagerModule.appendLoglinesToFile).mockResolvedValue(
        neverthrow.ok(undefined),
      );
      vi.mocked(logSyncModule.syncLogs).mockResolvedValue(
        neverthrow.ok({
          createdWorldJoinLogModelList: [],
          createdPlayerJoinLogModelList: [],
          createdPlayerLeaveLogModelList: [],
          createdVRChatPhotoPathModelList: [],
        }),
      );

      const result = await importService.importLogStoreFiles(
        paths,
        mockGetDBLogs,
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // logStore-2023-11.txt と vrchat-albums-export_data.txt のみが処理される
        expect(result.value.importedData.processedFiles).toHaveLength(2);
        expect(result.value.importedData.totalLines).toBe(2);
      }
    });
  });
});
