import type { Dirent } from 'node:fs';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as neverthrow from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as dbQueueModule from '../../../lib/dbQueue';
import * as logSyncModule from '../../logSync/service';
import { VRChatLogFileError } from '../error';
import * as logStorageManagerModule from '../fileHandlers/logStorageManager';
import type { ImportBackupMetadata } from './backupService';
import * as backupServiceModule from './backupService';
import { rollbackService } from './rollbackService';

// モックの設定
vi.mock('node:fs', () => ({
  promises: {
    access: vi.fn(),
    readdir: vi.fn(),
    rm: vi.fn(),
    mkdir: vi.fn(),
    cp: vi.fn(),
  },
}));

vi.mock('./backupService', () => ({
  backupService: {
    getBackupBasePath: vi.fn(() => path.join('/mocked', 'userData', 'backups')),
    updateBackupMetadata: vi.fn(),
  },
}));

vi.mock('../fileHandlers/logStorageManager', () => ({
  getLogStoreDir: vi.fn(() => path.join('/mocked', 'logStore')),
  initLogStoreDir: vi.fn(),
}));

vi.mock('../../logSync/service', () => ({
  LOG_SYNC_MODE: {
    FULL: 'full',
    INCREMENTAL: 'incremental',
  },
  syncLogs: vi.fn(),
}));

vi.mock('../../../lib/dbQueue', () => ({
  getDBQueue: vi.fn(() => ({
    transaction: vi.fn(async (callback) => {
      const result = await callback();
      return neverthrow.ok(result);
    }),
  })),
}));

describe('rollbackService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockBackup: ImportBackupMetadata = {
    id: 'backup_20231201_143045',
    backupTimestamp: new Date('2023-12-01T14:30:45'),
    exportFolderPath: 'vrchat-albums-export_2023-12-01_14-30-45',
    sourceFiles: ['/path/to/import.txt'],
    status: 'completed',
    importTimestamp: new Date('2023-12-01T14:35:00'),
    totalLogLines: 100,
    exportedFiles: [
      path.join(
        '/mocked/userData/backups',
        'vrchat-albums-export_2023-12-01_14-30-45',
        '2023-11',
        'logStore-2023-11.txt',
      ),
    ],
  };

  describe('rollbackToBackup', () => {
    it('バックアップからロールバックできる', async () => {
      // バックアップデータの存在確認
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue([
        {
          name: '2023-11',
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
          name: 'backup-metadata.json',
          isDirectory: () => false,
          isFile: () => true,
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isFIFO: () => false,
          isSocket: () => false,
          isSymbolicLink: () => false,
          path: '',
          parentPath: '',
        } as unknown as Dirent<Buffer>,
      ]);

      // logStoreディレクトリのクリア
      vi.mocked(fs.rm).mockResolvedValue(undefined);

      // logStore復帰
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.cp).mockResolvedValue(undefined);

      // DB再構築
      vi.mocked(logSyncModule.syncLogs).mockResolvedValue(
        neverthrow.ok({
          createdWorldJoinLogModelList: [],
          createdPlayerJoinLogModelList: [],
          createdPlayerLeaveLogModelList: [],
          createdVRChatPhotoPathModelList: [],
        }),
      );

      // バックアップ状態更新
      vi.mocked(
        backupServiceModule.backupService.updateBackupMetadata,
      ).mockResolvedValue(neverthrow.ok(undefined));

      const result = await rollbackService.rollbackToBackup(mockBackup);

      expect(result.isOk()).toBe(true);

      // logStoreがクリアされたことを確認
      expect(fs.rm).toHaveBeenCalledWith(path.join('/mocked', 'logStore'), {
        recursive: true,
        force: true,
      });

      // logStoreが復帰されたことを確認
      expect(fs.cp).toHaveBeenCalledWith(
        path.join(
          '/mocked/userData/backups',
          'vrchat-albums-export_2023-12-01_14-30-45',
          '2023-11',
        ),
        path.join('/mocked/logStore', '2023-11'),
        { recursive: true, force: true },
      );

      // DB再構築が実行されたことを確認
      expect(logSyncModule.syncLogs).toHaveBeenCalledWith('full');

      // バックアップ状態が更新されたことを確認
      expect(
        backupServiceModule.backupService.updateBackupMetadata,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          ...mockBackup,
          status: 'rolled_back',
        }),
      );
    });

    it('バックアップデータが存在しない場合はエラーを返す', async () => {
      // バックアップディレクトリが存在しない
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

      const result = await rollbackService.rollbackToBackup(mockBackup);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain(
          'バックアップディレクトリが見つかりません',
        );
      }
    });

    it('月別データが存在しない場合はエラーを返す', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue([
        {
          name: 'backup-metadata.json',
          isDirectory: () => false,
          isFile: () => true,
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isFIFO: () => false,
          isSocket: () => false,
          isSymbolicLink: () => false,
          path: '',
          parentPath: '',
        } as unknown as Dirent<Buffer>,
      ]);

      const result = await rollbackService.rollbackToBackup(mockBackup);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain(
          'バックアップに有効な月別データが見つかりません',
        );
      }
    });

    it('logStore復帰に失敗した場合はエラーを返す', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue([
        {
          name: '2023-11',
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
      ]);
      vi.mocked(fs.rm).mockResolvedValue(undefined);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.cp).mockRejectedValue(new Error('Copy failed'));

      const result = await rollbackService.rollbackToBackup(mockBackup);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain(
          'バックアップからディレクトリを復帰できませんでした',
        );
      }
    });

    it('DB再構築に失敗した場合はエラーを返す', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue([
        {
          name: '2023-11',
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
      ]);
      vi.mocked(fs.rm).mockResolvedValue(undefined);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.cp).mockResolvedValue(undefined);
      vi.mocked(logSyncModule.syncLogs).mockResolvedValue(
        neverthrow.err(new VRChatLogFileError('LOG_FILES_NOT_FOUND')),
      );

      const result = await rollbackService.rollbackToBackup(mockBackup);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('DB再構築に失敗しました');
      }
    });

    it('トランザクション内でエラーが発生した場合は適切に処理される', async () => {
      // トランザクションがエラーを返すようにモック
      vi.mocked(dbQueueModule.getDBQueue).mockReturnValueOnce({
        transaction: vi.fn(async () => {
          // トランザクションがエラーを返す
          return neverthrow.err({
            type: 'TRANSACTION_ERROR' as const,
            message: 'Transaction failed',
          });
        }),
      } as unknown as ReturnType<typeof dbQueueModule.getDBQueue>);

      const result = await rollbackService.rollbackToBackup(mockBackup);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain(
          'ロールバックトランザクションに失敗しました',
        );
      }
    });
  });

  describe('validateBackupData (private)', () => {
    // プライベートメソッドのテストはrollbackToBackup経由で行う
    it('メタデータファイルが存在しない場合は検証エラー', async () => {
      vi.mocked(fs.access).mockImplementation(async (p) => {
        if (p.toString().includes('backup-metadata.json')) {
          throw new Error('ENOENT');
        }
        return undefined;
      });
      vi.mocked(fs.readdir).mockResolvedValue([
        {
          name: '2023-11',
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
      ]);

      const result = await rollbackService.rollbackToBackup(mockBackup);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain(
          'バックアップメタデータファイルが見つかりません',
        );
      }
    });
  });

  describe('clearCurrentLogStore (private)', () => {
    // logStoreディレクトリのクリア処理のテスト
    it('logStoreディレクトリが存在しない場合もエラーにならない', async () => {
      vi.mocked(fs.access).mockImplementation(async (p) => {
        if (p === path.join('/mocked', 'logStore')) {
          throw new Error('ENOENT');
        }
        return undefined;
      });
      vi.mocked(fs.readdir).mockResolvedValue([
        {
          name: '2023-11',
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
      ]);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.cp).mockResolvedValue(undefined);
      vi.mocked(logSyncModule.syncLogs).mockResolvedValue(
        neverthrow.ok({
          createdWorldJoinLogModelList: [],
          createdPlayerJoinLogModelList: [],
          createdPlayerLeaveLogModelList: [],
          createdVRChatPhotoPathModelList: [],
        }),
      );
      vi.mocked(
        backupServiceModule.backupService.updateBackupMetadata,
      ).mockResolvedValue(neverthrow.ok(undefined));

      const result = await rollbackService.rollbackToBackup(mockBackup);

      expect(result.isOk()).toBe(true);
      // fs.rmが呼ばれていないことを確認
      expect(fs.rm).not.toHaveBeenCalled();
      // initLogStoreDirが呼ばれたことを確認
      expect(logStorageManagerModule.initLogStoreDir).toHaveBeenCalled();
    });
  });

  describe('restoreLogStoreFromBackup (private)', () => {
    // 部分的な復帰でも処理を継続する
    it('一部のディレクトリ復帰に失敗しても他のディレクトリは復帰する', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue([
        {
          name: '2023-11',
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
          name: '2023-12',
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
      ]);
      vi.mocked(fs.rm).mockResolvedValue(undefined);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);

      // 最初のディレクトリはコピー失敗、2番目は成功
      let cpCallCount = 0;
      vi.mocked(fs.cp).mockImplementation(async () => {
        cpCallCount++;
        if (cpCallCount === 1) {
          throw new Error('Copy failed for first directory');
        }
        return undefined;
      });

      vi.mocked(logSyncModule.syncLogs).mockResolvedValue(
        neverthrow.ok({
          createdWorldJoinLogModelList: [],
          createdPlayerJoinLogModelList: [],
          createdPlayerLeaveLogModelList: [],
          createdVRChatPhotoPathModelList: [],
        }),
      );
      vi.mocked(
        backupServiceModule.backupService.updateBackupMetadata,
      ).mockResolvedValue(neverthrow.ok(undefined));

      const result = await rollbackService.rollbackToBackup(mockBackup);

      // 一部失敗しても処理は成功する
      expect(result.isOk()).toBe(true);
      expect(fs.cp).toHaveBeenCalledTimes(2);
    });

    it('すべてのディレクトリ復帰に失敗した場合はエラー', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue([
        {
          name: '2023-11',
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
      ]);
      vi.mocked(fs.rm).mockResolvedValue(undefined);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.cp).mockRejectedValue(new Error('Copy failed'));

      const result = await rollbackService.rollbackToBackup(mockBackup);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain(
          'バックアップからディレクトリを復帰できませんでした',
        );
      }
    });
  });
});
