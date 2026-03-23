import type { Dirent } from 'node:fs';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { Cause, Effect, Exit, Option } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as dbQueueModule from '../../../lib/dbQueue';
import * as logSyncModule from '../../logSync/service';
import { LogFilesNotFound } from '../errors';
import * as logStorageManagerModule from '../fileHandlers/logStorageManager';
import type { ImportBackupMetadata } from './backupService';
import * as backupServiceModule from './backupService';
import { getRollbackErrorMessage, rollbackService } from './rollbackService';

// モックの設定
vi.mock('node:fs', () => ({
  promises: {
    access: vi.fn(),
    stat: vi.fn(),
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
    transaction: vi.fn((callback: (t: unknown) => Promise<unknown>) => {
      return Effect.tryPromise({
        try: () => callback(undefined),
        catch: (e) => {
          throw e;
        },
      });
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
      vi.mocked(fs.stat).mockResolvedValue(undefined as unknown as never);
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
      vi.mocked(fs.rm).mockResolvedValue(undefined as unknown as never);

      // logStore復帰
      vi.mocked(fs.mkdir).mockResolvedValue(undefined as unknown as never);
      vi.mocked(fs.cp).mockResolvedValue(undefined as unknown as never);

      // DB再構築
      vi.mocked(logSyncModule.syncLogs).mockReturnValue(
        Effect.succeed({
          createdWorldJoinLogModelList: [],
          createdPlayerJoinLogModelList: [],
          createdPlayerLeaveLogModelList: [],
          createdVRChatPhotoPathModelList: [],
        }),
      );

      // バックアップ状態更新
      vi.mocked(
        backupServiceModule.backupService.updateBackupMetadata,
      ).mockReturnValue(Effect.succeed(undefined));

      await Effect.runPromise(rollbackService.rollbackToBackup(mockBackup));

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
      vi.mocked(fs.stat).mockRejectedValue(new Error('ENOENT'));

      const exit = await Effect.runPromiseExit(
        rollbackService.rollbackToBackup(mockBackup),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failOpt = Cause.failureOption(exit.cause);
        if (Option.isSome(failOpt)) {
          expect(getRollbackErrorMessage(failOpt.value)).toContain(
            'バックアップディレクトリが見つかりません',
          );
        }
      }
    });

    it('月別データが存在しない場合はエラーを返す', async () => {
      vi.mocked(fs.stat).mockResolvedValue(undefined as unknown as never);
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

      const exit = await Effect.runPromiseExit(
        rollbackService.rollbackToBackup(mockBackup),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failOpt = Cause.failureOption(exit.cause);
        if (Option.isSome(failOpt)) {
          expect(getRollbackErrorMessage(failOpt.value)).toContain(
            '有効な月別データが見つかりません',
          );
        }
      }
    });

    it('logStore復帰に失敗した場合は予期しないエラーとしてthrowされる', async () => {
      vi.mocked(fs.stat).mockResolvedValue(undefined as unknown as never);
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
      vi.mocked(fs.rm).mockResolvedValue(undefined as unknown as never);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined as unknown as never);
      vi.mocked(fs.cp).mockRejectedValue(new Error('Copy failed'));

      // ファイルシステムエラーは予期しないエラーとしてthrowされる（Sentryに送信）
      await expect(
        Effect.runPromise(rollbackService.rollbackToBackup(mockBackup)),
      ).rejects.toThrow('Copy failed');
    });

    it('DB再構築に失敗した場合はエラーを返す', async () => {
      vi.mocked(fs.stat).mockResolvedValue(undefined as unknown as never);
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
      vi.mocked(fs.rm).mockResolvedValue(undefined as unknown as never);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined as unknown as never);
      vi.mocked(fs.cp).mockResolvedValue(undefined as unknown as never);
      vi.mocked(logSyncModule.syncLogs).mockReturnValue(
        Effect.fail(
          new LogFilesNotFound({
            message: 'No VRChat log files found',
          }),
        ),
      );

      const exit = await Effect.runPromiseExit(
        rollbackService.rollbackToBackup(mockBackup),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failOpt = Cause.failureOption(exit.cause);
        if (Option.isSome(failOpt)) {
          expect(getRollbackErrorMessage(failOpt.value)).toContain(
            'DB再構築に失敗しました',
          );
        }
      }
    });

    it('キューがタイムアウトした場合は適切に処理される', async () => {
      // トランザクションがTASK_TIMEOUTエラーを返すようにモック
      vi.mocked(dbQueueModule.getDBQueue).mockReturnValueOnce({
        transaction: vi.fn(() => {
          return Effect.fail({
            type: 'TASK_TIMEOUT' as const,
            message: 'Task timeout',
          });
        }),
      } as unknown as ReturnType<typeof dbQueueModule.getDBQueue>);

      const exit = await Effect.runPromiseExit(
        rollbackService.rollbackToBackup(mockBackup),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failOpt = Cause.failureOption(exit.cause);
        if (Option.isSome(failOpt)) {
          expect(getRollbackErrorMessage(failOpt.value)).toContain(
            'トランザクションに失敗しました',
          );
        }
      }
    });

    it('予期しないエラーが発生した場合はそのままthrowされる', async () => {
      const unexpectedError = new Error('Unexpected database error');
      // トランザクションが予期しないエラーをthrowするようにモック
      vi.mocked(dbQueueModule.getDBQueue).mockReturnValueOnce({
        transaction: vi.fn(() => {
          return Effect.die(unexpectedError);
        }),
      } as unknown as ReturnType<typeof dbQueueModule.getDBQueue>);

      // 予期しないエラーはそのままthrowされる（Sentryに送信される）
      await expect(
        Effect.runPromise(rollbackService.rollbackToBackup(mockBackup)),
      ).rejects.toThrow('Unexpected database error');
    });
  });

  describe('validateBackupData (private)', () => {
    // プライベートメソッドのテストはrollbackToBackup経由で行う
    it('メタデータファイルが存在しない場合は検証エラー', async () => {
      vi.mocked(fs.stat).mockImplementation(async (p) => {
        if (p.toString().includes('backup-metadata.json')) {
          throw new Error('ENOENT');
        }
        return {} as never;
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

      const exit = await Effect.runPromiseExit(
        rollbackService.rollbackToBackup(mockBackup),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failOpt = Cause.failureOption(exit.cause);
        if (Option.isSome(failOpt)) {
          expect(getRollbackErrorMessage(failOpt.value)).toContain(
            'メタデータファイルが見つかりません',
          );
        }
      }
    });
  });

  describe('clearCurrentLogStore (private)', () => {
    // logStoreディレクトリのクリア処理のテスト
    // fs.rm は force: true で呼ばれるので、ディレクトリが存在しなくてもエラーにならない
    it('logStoreディレクトリをクリアする', async () => {
      vi.mocked(fs.stat).mockResolvedValue(undefined as unknown as never);
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
      vi.mocked(fs.rm).mockResolvedValue(undefined as unknown as never);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined as unknown as never);
      vi.mocked(fs.cp).mockResolvedValue(undefined as unknown as never);
      vi.mocked(logSyncModule.syncLogs).mockReturnValue(
        Effect.succeed({
          createdWorldJoinLogModelList: [],
          createdPlayerJoinLogModelList: [],
          createdPlayerLeaveLogModelList: [],
          createdVRChatPhotoPathModelList: [],
        }),
      );
      vi.mocked(
        backupServiceModule.backupService.updateBackupMetadata,
      ).mockReturnValue(Effect.succeed(undefined));

      await Effect.runPromise(rollbackService.rollbackToBackup(mockBackup));
      // fs.rmがforce: trueで呼ばれることを確認
      expect(fs.rm).toHaveBeenCalledWith(expect.stringContaining('logStore'), {
        recursive: true,
        force: true,
      });
      // initLogStoreDirが呼ばれたことを確認
      expect(logStorageManagerModule.initLogStoreDir).toHaveBeenCalled();
    });
  });

  describe('restoreLogStoreFromBackup (private)', () => {
    // ファイルシステムエラーは予期しないエラーとしてthrow（Sentryに送信）
    it('ディレクトリ復帰に失敗した場合は予期しないエラーとしてthrowされる', async () => {
      vi.mocked(fs.stat).mockResolvedValue(undefined as unknown as never);
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
      vi.mocked(fs.rm).mockResolvedValue(undefined as unknown as never);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined as unknown as never);
      vi.mocked(fs.cp).mockRejectedValue(new Error('Copy failed'));

      // ファイルシステムエラーは予期しないエラーとしてthrowされる
      await expect(
        Effect.runPromise(rollbackService.rollbackToBackup(mockBackup)),
      ).rejects.toThrow('Copy failed');
    });
  });
});
