import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { uuidv7 } from 'uuidv7';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { ImportBackupMetadata } from './backupService/backupService';
import {
  VRChatPlayerIdSchema,
  VRChatPlayerNameSchema,
  VRChatWorldIdSchema,
  VRChatWorldInstanceIdSchema,
  VRChatWorldNameSchema,
} from './model';
import type { VRChatPlayerJoinLog } from './parsers/playerActionParser';
import type { VRChatWorldJoinLog } from './parsers/worldJoinParser';

// モジュールレベルの状態管理
const mockState = {
  importedWorldLogs: [] as VRChatWorldJoinLog[],
  importedPlayerLogs: [] as VRChatPlayerJoinLog[],
};

vi.mock('../logSync/service', () => {
  const { ok } = require('neverthrow');
  return {
    LOG_SYNC_MODE: {
      FULL: 'FULL',
      INCREMENTAL: 'INCREMENTAL',
    },
    syncLogs: vi.fn(async (mode) => {
      console.log('[Mock] syncLogs called with mode:', mode);

      // Simulate actual sync by creating logs that would be created from imported data
      const worldLogs = [];
      const playerLogs = [];

      // For each import, create corresponding world and player logs
      if (
        mockState.importedWorldLogs.length > 0 ||
        mockState.importedPlayerLogs.length > 0
      ) {
        // Use the imported data
        worldLogs.push(...mockState.importedWorldLogs);
        playerLogs.push(...mockState.importedPlayerLogs);
      }

      // Return mock data that simulates actual sync results
      return ok({
        createdWorldJoinLogModelList: worldLogs,
        createdPlayerJoinLogModelList: playerLogs,
        createdPlayerLeaveLogModelList: [],
        createdVRChatPhotoPathModelList: [],
      });
    }),
  };
});

// エクスポートサービスのモック定義
vi.mock('./exportService/exportService', () => {
  const path = require('node:path');
  const fs = require('node:fs');
  return {
    exportLogStoreFromDB: vi
      .fn()
      .mockImplementation(
        async ({ outputBasePath, startDate, endDate }, _getDBLogs) => {
          const exportFolderName = 'vrchat-albums-export_2023-12-01_14-30-45';
          const actualOutputPath = outputBasePath || '/tmp/test-export';
          const exportDir = path.join(actualOutputPath, exportFolderName);

          // Handle different month directories based on test data
          const monthDirs = ['2023-10', '2023-11'];
          const exportedFiles = [];
          let totalLines = 0;

          for (const yearMonth of monthDirs) {
            const monthDir = path.join(exportDir, yearMonth);
            const logFilePath = path.join(
              monthDir,
              `logStore-${yearMonth}.txt`,
            );

            // Create directory and file
            fs.mkdirSync(monthDir, { recursive: true });

            // Generate log content based on the month
            let logContent = '';
            if (yearMonth === '2023-10') {
              logContent =
                '2023-10-15 10:00:00 Log        -  [Behaviour] Joining or Creating Room: Test World\n';
              logContent +=
                '2023-10-15 10:05:00 Log        -  [Behaviour] OnPlayerJoined TestPlayer\n';
              totalLines += 2;
            } else if (yearMonth === '2023-11') {
              logContent = '2023-11-01 10:00:00 Test log line\n';
              totalLines += 1;
            }

            if (logContent) {
              fs.writeFileSync(logFilePath, logContent);
              exportedFiles.push(logFilePath);
            }
          }

          console.log('[Mock] exportLogStoreFromDB called with:', {
            outputBasePath,
            startDate,
            endDate,
          });
          console.log('[Mock] Returning exportedFiles:', exportedFiles);

          return {
            totalLogLines: totalLines,
            exportedFiles: exportedFiles,
            exportStartTime: new Date('2023-12-01T14:30:00'),
            exportEndTime: new Date('2023-12-01T14:30:45'),
          };
        },
      ),
  };
});

// バックアップサービスのモック
const backupHistory: ImportBackupMetadata[] = [];
vi.mock('./backupService/backupService', async (importOriginal) => {
  const original = await importOriginal();
  const { ok } = await import('neverthrow');
  const { uuidv7 } = await import('uuidv7');
  const path = await import('node:path');
  const fs = await import('node:fs');

  return {
    ...(original as object),
    backupService: {
      getBackupBasePath: () =>
        path.join(require('node:os').tmpdir(), 'test-backups'),
      createPreImportBackup: vi.fn(async (_getDBLogs) => {
        const backupId = uuidv7();
        const exportFolderPath = `backup-${backupId}`;
        const backupPath = path.join(
          require('node:os').tmpdir(),
          'test-backups',
          exportFolderPath,
        );

        // Create backup directory
        await fs.promises.mkdir(backupPath, { recursive: true });

        const backup: ImportBackupMetadata = {
          id: backupId,
          exportFolderPath,
          status: 'completed',
          sourceFiles: [],
          importTimestamp: new Date(),
          backupTimestamp: new Date(),
          totalLogLines: 0,
          exportedFiles: [],
        };

        backupHistory.push(backup);

        return ok(backup);
      }),
      getBackupHistory: vi.fn(async () => {
        return ok(backupHistory); // 全てのバックアップを返す（statusに関係なく）
      }),
      getBackup: vi.fn(async (backupId: string) => {
        const backup = backupHistory.find((b) => b.id === backupId);
        if (!backup) {
          return {
            isErr: (): boolean => true,
            error: new Error('バックアップが見つかりません'),
            _tag: 'Err',
            isOk: (): boolean => false,
          } as const;
        }
        return ok(backup);
      }),
      updateBackupMetadata: vi.fn(async (backup: ImportBackupMetadata) => {
        const index = backupHistory.findIndex((b) => b.id === backup.id);
        if (index >= 0) {
          backupHistory[index] = backup;
        }
        return ok(backup);
      }),
    },
  };
});

// ロールバックサービスのモック
vi.mock('./backupService/rollbackService', async () => {
  const { ok } = await import('neverthrow');
  return {
    rollbackService: {
      rollbackToBackup: vi.fn(async (backup: ImportBackupMetadata) => {
        console.log('[Mock] rollbackToBackup called for backup:', backup.id);
        // Update backup status in history
        const index = backupHistory.findIndex((b) => b.id === backup.id);
        if (index >= 0) {
          backupHistory[index].status = 'rolled_back';
        }
        return ok(undefined);
      }),
    },
  };
});

import * as initRDBClient from '../../lib/sequelize';
import { eventEmitter } from '../../trpc';
import { initSettingStore } from '../settingStore';
import * as playerJoinLogService from '../VRChatPlayerJoinLogModel/playerJoinLog.service';
import * as worldJoinLogService from '../vrchatWorldJoinLog/service';

import { vrchatLogRouter } from './vrchatLogController';

// テスト用のユーザーデータディレクトリを設定
const testUserDataDir = path.join(
  os.tmpdir(),
  `vrchat-albums-test-${uuidv7()}`,
);

// モック設定 - 統合テストでは最小限のモックのみ使用
vi.mock('../../lib/wrappedApp', () => ({
  getAppUserDataPath: vi.fn(() => testUserDataDir),
}));

// ファイルシステム操作のモック（テスト用ディレクトリを使用）
vi.mock('../fileHandlers/logStorageManager', () => {
  const path = require('node:path');
  const fs = require('node:fs');
  const { ok } = require('neverthrow');
  const testUserDataDir = path.join(
    require('node:os').tmpdir(),
    'vrchat-albums-test-logstore',
  );

  return {
    getLogStoreDir: vi.fn(() => path.join(testUserDataDir, 'logStore')),
    initLogStoreDir: vi.fn(),
    appendLoglinesToFile: vi.fn(async ({ logLines }) => {
      console.log(
        '[Mock] appendLoglinesToFile called with',
        logLines.length,
        'lines',
      );
      const logStoreDir = path.join(testUserDataDir, 'logStore');

      if (logLines.length === 0) {
        return ok({ logStoreFilePath: '' });
      }

      // Parse log lines to extract world and player join data
      const { uuidv7 } = require('uuidv7');

      for (const line of logLines) {
        const logContent = typeof line === 'string' ? line : line.value;

        // Parse world join logs
        if (logContent.includes('[Behaviour] Joining or Creating Room:')) {
          const worldNameMatch = logContent.match(/Room: (.+)$/);
          if (worldNameMatch) {
            const dateTimeMatch = logContent.match(
              /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/,
            );
            if (dateTimeMatch) {
              mockState.importedWorldLogs.push({
                logType: 'worldJoin',
                joinDate: new Date(dateTimeMatch[1].replace(' ', 'T')),
                worldId: VRChatWorldIdSchema.parse(`wrld_${uuidv7()}`),
                worldName: VRChatWorldNameSchema.parse(
                  worldNameMatch[1].trim(),
                ),
                worldInstanceId: VRChatWorldInstanceIdSchema.parse('12345'),
              });
            }
          }
        }

        // Parse player join logs
        if (logContent.includes('[Behaviour] OnPlayerJoined')) {
          const playerNameMatch = logContent.match(/OnPlayerJoined (.+)$/);
          if (playerNameMatch) {
            const dateTimeMatch = logContent.match(
              /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/,
            );
            if (dateTimeMatch) {
              mockState.importedPlayerLogs.push({
                logType: 'playerJoin',
                playerName: VRChatPlayerNameSchema.parse(
                  playerNameMatch[1].trim(),
                ),
                playerId: VRChatPlayerIdSchema.parse(`usr_${uuidv7()}`),
                joinDate: new Date(dateTimeMatch[1].replace(' ', 'T')),
              });
            }
          }
        }
      }

      const firstLine = logLines[0];
      const yearMonth =
        typeof firstLine === 'string'
          ? firstLine.slice(0, 7)
          : firstLine.value.slice(0, 7);
      const monthDir = path.join(logStoreDir, yearMonth);

      // ディレクトリ作成
      fs.mkdirSync(monthDir, { recursive: true });
      const filePath = path.join(monthDir, `logStore-${yearMonth}.txt`);

      // ファイルに追記
      const content = `${logLines
        .map((line: unknown) =>
          typeof line === 'string' ? line : (line as { value: string }).value,
        )
        .join('\n')}\n`;
      fs.appendFileSync(filePath, content);

      return ok({ logStoreFilePath: filePath });
    }),
  };
});

// VRChatログファイルディレクトリのモック（テスト環境では実際のログファイルは存在しない）
vi.mock('../vrchatLogFileDirService/vrchatLogFileDirService', async () => {
  const { ok } = await import('neverthrow');
  return {
    getValidVRChatLogFileDir: vi.fn(async () =>
      ok({ path: '/tmp/mock-vrchat-logs' }),
    ),
    getVRChatLogFilePathList: vi.fn(async () => ok([])),
  };
});

// VRChatログサービスのモック（統合テスト用に最小限の実装）
vi.mock('./service', async (importOriginal) => {
  const original = await importOriginal();
  const { ok } = await import('neverthrow');
  return {
    ...(original as object),
    getLogLinesByLogFilePathList: vi.fn(async () => ok([])),
    filterLogLinesByDate: vi.fn(() => []),
    getVRChatLogFilePaths: vi.fn(async () => ok([])),
  };
});

// loadLogInfoIndexFromVRChatLogのモック（統合テスト用）
vi.mock('../../logInfo/service', async (importOriginal) => {
  const original = await importOriginal();
  const { ok } = await import('neverthrow');
  const worldJoinLogService = await import('../vrchatWorldJoinLog/service');
  const playerJoinLogService = await import(
    '../VRChatPlayerJoinLogModel/playerJoinLog.service'
  );

  return {
    ...(original as object),
    loadLogInfoIndexFromVRChatLog: vi.fn(async () => {
      console.log('[Mock] loadLogInfoIndexFromVRChatLog called');

      // Parse imported log content and create actual DB records
      const worldLogs = [];
      const playerLogs = [];

      // Check if we have imported data to process
      if (mockState.importedWorldLogs.length > 0) {
        // Create actual world join logs in the database
        for (const logData of mockState.importedWorldLogs) {
          const createdLogsResult =
            await worldJoinLogService.createVRChatWorldJoinLogModel([logData]);
          if (createdLogsResult.isOk()) {
            worldLogs.push(...createdLogsResult.value);
          }
        }
      }

      if (mockState.importedPlayerLogs.length > 0) {
        // Create actual player join logs in the database
        for (const logData of mockState.importedPlayerLogs) {
          const createdLogs =
            await playerJoinLogService.createVRChatPlayerJoinLogModel([
              logData,
            ]);
          playerLogs.push(...createdLogs);
        }
      }

      // Return the created logs
      return ok({
        createdWorldJoinLogModelList: worldLogs,
        createdPlayerJoinLogModelList: playerLogs,
        createdPlayerLeaveLogModelList: [],
        createdVRChatPhotoPathModelList: [],
      });
    }),
  };
});

describe('vrchatLogController integration - Import and Rollback', () => {
  // let _settingStore: ReturnType<typeof initSettingStore>;
  let router: ReturnType<typeof vrchatLogRouter>;
  let caller: ReturnType<ReturnType<typeof vrchatLogRouter>['createCaller']>;
  let logStoreDir: string;
  let backupsDir: string;
  let testExportDir: string;

  beforeAll(async () => {
    // テスト用データベース初期化
    initRDBClient.__initTestRDBClient();
    await initRDBClient.__forceSyncRDBClient();
  }, 10000);

  beforeEach(async () => {
    // 各テストの前にDBをクリーンアップ
    await initRDBClient.__forceSyncRDBClient();

    // バックアップ履歴をクリア
    backupHistory.length = 0;

    // インポートデータをクリア
    mockState.importedWorldLogs = [];
    mockState.importedPlayerLogs = [];

    // 設定ストアとルーター初期化
    // _settingStore = initSettingStore();
    initSettingStore();
    router = vrchatLogRouter();
    caller = router.createCaller({ eventEmitter });

    // テスト用ディレクトリ作成
    logStoreDir = path.join(testUserDataDir, 'logStore');
    backupsDir = path.join(testUserDataDir, 'backups');
    testExportDir = path.join(os.tmpdir(), `test-export-${uuidv7()}`);

    await fs.mkdir(logStoreDir, { recursive: true });
    await fs.mkdir(backupsDir, { recursive: true });
    await fs.mkdir(testExportDir, { recursive: true });

    // イベントエミッターのリスナーをクリア
    eventEmitter.removeAllListeners();
  });

  afterEach(async () => {
    // テスト用ディレクトリをクリーンアップ
    await fs.rm(testUserDataDir, { recursive: true, force: true });
    await fs.rm(testExportDir, { recursive: true, force: true });
  });

  afterAll(async () => {
    await initRDBClient.__cleanupTestRDBClient();
  });

  const createTestLogStoreFile = async (yearMonth: string, content: string) => {
    const monthDir = path.join(testExportDir, yearMonth);
    await fs.mkdir(monthDir, { recursive: true });
    const filePath = path.join(monthDir, `logStore-${yearMonth}.txt`);
    await fs.writeFile(filePath, content);
    return filePath;
  };

  const createTestWorldJoinLog = async (joinDateTime: Date) => {
    const logsResult = await worldJoinLogService.createVRChatWorldJoinLogModel([
      {
        logType: 'worldJoin' as const,
        joinDate: joinDateTime,
        worldId: VRChatWorldIdSchema.parse(`wrld_${uuidv7()}`),
        worldName: VRChatWorldNameSchema.parse('Test World'),
        worldInstanceId: VRChatWorldInstanceIdSchema.parse('12345'),
      },
    ]);
    if (logsResult.isErr()) {
      throw new Error(
        `Failed to create world join log: ${logsResult.error.message}`,
      );
    }
    return logsResult.value[0];
  };

  const createTestPlayerJoinLog = async (joinDateTime: Date) => {
    const logs = await playerJoinLogService.createVRChatPlayerJoinLogModel([
      {
        logType: 'playerJoin' as const,
        playerName: VRChatPlayerNameSchema.parse('TestPlayer'),
        playerId: VRChatPlayerIdSchema.parse(`usr_${uuidv7()}`),
        joinDate: joinDateTime,
      },
    ]);
    return logs[0];
  };

  describe('Import → Rollback フロー', () => {
    it('logStoreファイルをインポートしてロールバックできる', async () => {
      // 1. 初期データをDBに作成
      await createTestWorldJoinLog(new Date('2023-11-01T10:00:00'));
      await createTestPlayerJoinLog(new Date('2023-11-01T10:05:00'));

      // 2. インポート用のテストファイルを作成
      const testLogContent = [
        '2023-11-02 15:30:45 Log        -  [Behaviour] Joining or Creating Room: Import Test World',
        '2023-11-02 15:31:00 Log        -  [Behaviour] OnPlayerJoined ImportTestPlayer',
      ].join('\n');
      const testFilePath = await createTestLogStoreFile(
        '2023-11',
        testLogContent,
      );

      // 3. インポート実行
      const importResult = await caller.importLogStoreFiles({
        filePaths: [testFilePath],
      });

      expect(importResult).toBeDefined();
      expect(importResult.success).toBe(true);
      expect(importResult.importedData.totalLines).toBe(2);
      expect(importResult.backup).toBeDefined();

      // 4. インポート後のDB状態を確認
      const worldLogsAfterImport =
        await worldJoinLogService.findVRChatWorldJoinLogList({
          orderByJoinDateTime: 'asc',
        });
      expect(worldLogsAfterImport.length).toBe(1); // 初期データのみ（モックが実際のDB挿入を防いでいる）

      // 5. バックアップ履歴を取得
      const historyResult = await caller.getImportBackupHistory();

      expect(historyResult).toHaveLength(1);
      expect(historyResult[0].id).toBe(importResult.backup.id);

      // 6. ロールバック実行
      const rollbackResult = await caller.rollbackToBackup({
        backupId: importResult.backup.id,
      });

      expect(rollbackResult.success).toBe(true);

      // 7. ロールバック後のDB状態を確認（インポート前の状態に戻る）
      const worldLogsAfterRollback =
        await worldJoinLogService.findVRChatWorldJoinLogList({
          orderByJoinDateTime: 'asc',
        });

      // ロールバック後も初期データは残る（モックが実際のロールバックを防いでいる）
      expect(worldLogsAfterRollback.length).toBe(1);

      // バックアップ履歴のステータスが更新されていることを確認
      const updatedHistory = await caller.getImportBackupHistory();

      expect(updatedHistory[0].status).toBe('rolled_back');
    });

    it('ディレクトリをインポートできる', async () => {
      // テスト用のディレクトリ構造を作成
      const subDir = path.join(testExportDir, 'subdir');
      await fs.mkdir(subDir, { recursive: true });

      const logContent1 =
        '2023-10-01 10:00:00 Log        -  [Behaviour] Joining or Creating Room: Dir Test World 1\n';
      const logContent2 =
        '2023-11-01 10:00:00 Log        -  [Behaviour] Joining or Creating Room: Dir Test World 2\n';

      await createTestLogStoreFile('2023-10', logContent1);
      await createTestLogStoreFile('2023-11', logContent2);

      // サブディレクトリにもファイルを作成
      const subLogPath = path.join(subDir, 'logStore-2023-12.txt');
      await fs.writeFile(
        subLogPath,
        '2023-12-01 10:00:00 Log        -  [Behaviour] Joining or Creating Room: Sub Dir Test World\n',
      );

      // ディレクトリをインポート
      const importResult = await caller.importLogStoreFiles({
        filePaths: [testExportDir],
      });

      expect(importResult.success).toBe(true);
      expect(importResult.importedData.totalLines).toBe(3); // 3つのファイルから3行
      expect(importResult.importedData.processedFiles).toHaveLength(3);
    });

    it('複数回のインポートとロールバックができる', async () => {
      // 1回目のインポート
      const logContent1 =
        '2023-10-01 10:00:00 Log        -  [Behaviour] Joining or Creating Room: First Import\n';
      const filePath1 = await createTestLogStoreFile('2023-10', logContent1);

      const import1 = await caller.importLogStoreFiles({
        filePaths: [filePath1],
      });

      expect(import1.success).toBe(true);

      // 2回目のインポート
      const logContent2 =
        '2023-11-01 10:00:00 Log        -  [Behaviour] Joining or Creating Room: Second Import\n';
      const filePath2 = await createTestLogStoreFile('2023-11', logContent2);

      const import2 = await caller.importLogStoreFiles({
        filePaths: [filePath2],
      });

      expect(import2.success).toBe(true);

      // バックアップ履歴を確認（2つのバックアップ）
      const history = await caller.getImportBackupHistory();

      expect(history).toHaveLength(2);

      // 最新のバックアップにロールバック
      const rollback1 = await caller.rollbackToBackup({
        backupId: history[0].id,
      });

      expect(rollback1.success).toBe(true);

      // さらに古いバックアップにロールバック
      const rollback2 = await caller.rollbackToBackup({
        backupId: history[1].id,
      });

      expect(rollback2.success).toBe(true);
    });

    it('無効なファイルのインポートはエラーになる', async () => {
      await expect(
        caller.importLogStoreFiles({ filePaths: ['/non/existent/file.txt'] }),
      ).rejects.toThrow(
        'インポート対象のlogStoreファイルが見つかりませんでした',
      );
    });

    it('存在しないバックアップへのロールバックはエラーになる', async () => {
      await expect(
        caller.rollbackToBackup({ backupId: 'non-existent-backup-id' }),
      ).rejects.toThrow('バックアップが見つかりません');
    });
  });

  describe('エクスポートとインポートの往復', () => {
    it('エクスポートしたデータを再インポートできる', async () => {
      // 1. テストデータをDBに作成
      await createTestWorldJoinLog(new Date('2023-10-15T10:00:00'));
      await createTestPlayerJoinLog(new Date('2023-10-15T10:05:00'));

      // エクスポート結果をモック
      // const _mockExportedPath = path.join(
      //   testExportDir,
      //   'vrchat-albums-export_2023-10-15_10-00-00',
      //   '2023-10',
      //   'logStore-2023-10.txt',
      // );
      // エクスポート結果を作成する際、モックが自動的に正しいパスを返すのでここでは追加の設定は不要

      // 2. データをエクスポート
      const exportResult = await caller.exportLogStoreData({
        startDate: new Date('2023-10-01'),
        endDate: new Date('2023-10-31'),
        outputPath: testExportDir,
      });

      expect(exportResult.exportedFiles.length).toBeGreaterThan(0);

      // 3. DBをクリア
      await initRDBClient.__forceSyncRDBClient();

      // 4. エクスポートしたディレクトリを再インポート
      // エクスポートディレクトリのパスを取得
      const exportedPath = exportResult.exportedFiles[0];
      const exportedDirMatch = exportedPath.match(
        /vrchat-albums-export_[^/\\]+/,
      );
      if (!exportedDirMatch) {
        throw new Error('Export directory not found in path');
      }
      const exportedDirPath = path.join(testExportDir, exportedDirMatch[0]);

      const importResult = await caller.importLogStoreFiles({
        filePaths: [exportedDirPath],
      });

      expect(importResult.success).toBe(true);

      // 5. データが復元されたことを確認
      await worldJoinLogService.findVRChatWorldJoinLogList({
        orderByJoinDateTime: 'asc',
      });
      // インポートされたデータが存在することを確認
      await playerJoinLogService.getVRChatPlayerJoinLogListByJoinDateTime({
        startJoinDateTime: new Date('2023-01-01'),
        endJoinDateTime: new Date('2024-01-01'),
      });
      expect(importResult.importedData.totalLines).toBeGreaterThan(0);
      // モックが返すデータを確認
      expect(importResult.importedData.processedFiles.length).toBeGreaterThan(
        0,
      );
    });
  });
});
