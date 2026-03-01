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

// Minimal mocks - only mock what's absolutely necessary for test environment
const testUserDataDir = path.join(
  os.tmpdir(),
  `vrchat-albums-test-${uuidv7()}`,
);

vi.mock('../../lib/wrappedApp', () => ({
  getAppUserDataPath: vi.fn(() => testUserDataDir),
}));

// Mock VRChat log directory (since we don't have actual VRChat logs in test)
vi.mock('../vrchatLogFileDirService/vrchatLogFileDirService', async () => {
  const { ok } = await import('neverthrow');
  return {
    getValidVRChatLogFileDir: vi.fn(async () =>
      ok({ path: '/tmp/mock-vrchat-logs' }),
    ),
    getVRChatLogFilePathList: vi.fn(async () => ok([])),
  };
});

// Mock only the VRChat log file reading part
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

// Mock the log sync service to avoid LOG_FILE_WRITE_FAILED error
vi.mock('../logSync/service', async () => {
  const { ok } = await import('neverthrow');
  return {
    syncLogs: vi.fn(async () => ok({ success: true })),
    LOG_SYNC_MODE: {
      FULL: 'FULL',
      INCREMENTAL: 'INCREMENTAL',
    },
  };
});

import * as initRDBClient from '../../lib/sequelize';
import { eventEmitter } from '../../trpc';
import { initSettingStore } from '../settingStore';
import * as playerJoinLogService from '../VRChatPlayerJoinLogModel/playerJoinLog.service';
import * as worldJoinLogService from '../vrchatWorldJoinLog/service';

import {
  VRChatPlayerIdSchema,
  VRChatPlayerNameSchema,
  VRChatWorldIdSchema,
  VRChatWorldInstanceIdSchema,
  VRChatWorldNameSchema,
} from './model';
import { vrchatLogRouter } from './vrchatLogController';

describe('vrchatLogController integration test with minimal mocks', () => {
  let router: ReturnType<typeof vrchatLogRouter>;
  let caller: ReturnType<ReturnType<typeof vrchatLogRouter>['createCaller']>;
  let testExportDir: string;

  beforeAll(async () => {
    // Initialize test database
    await initRDBClient.__initTestRDBClient();
    await initRDBClient.__forceSyncRDBClient();
  }, 10000);

  beforeEach(async () => {
    // Clean up DB before each test
    await initRDBClient.__forceSyncRDBClient();

    // Initialize settings and router
    initSettingStore();
    router = vrchatLogRouter();
    caller = router.createCaller({ eventEmitter });

    // Create test directories
    testExportDir = path.join(os.tmpdir(), `test-export-${uuidv7()}`);
    await fs.mkdir(testExportDir, { recursive: true });

    // Clear event listeners
    eventEmitter.removeAllListeners();
  });

  afterEach(async () => {
    // Clean up test directories
    await fs.rm(testUserDataDir, { recursive: true, force: true });
    await fs.rm(testExportDir, { recursive: true, force: true });
  });

  afterAll(async () => {
    await initRDBClient.__cleanupTestRDBClient();
  });

  // Unused function - commented out to pass linting
  // const createTestLogStoreFile = async (
  //   yearMonth: string,
  //   content: string,
  // ) => {
  //   const monthDir = path.join(testExportDir, yearMonth);
  //   await fs.mkdir(monthDir, { recursive: true });
  //   const filePath = path.join(monthDir, `logStore-${yearMonth}.txt`);
  //   await fs.writeFile(filePath, content);
  //   return filePath;
  // };

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

  it('エクスポートしたデータを再インポートできる（実際のサービスを使用）', async () => {
    // 1. Create test data in DB
    await createTestWorldJoinLog(new Date('2023-10-15T10:00:00'));
    await createTestPlayerJoinLog(new Date('2023-10-15T10:05:00'));

    // 2. Export data
    const exportResult = await caller.exportLogStoreData({
      startDate: new Date('2023-10-01'),
      endDate: new Date('2023-10-31'),
      outputPath: testExportDir,
    });

    expect(exportResult.exportedFiles.length).toBeGreaterThan(0);
    expect(exportResult.totalLogLines).toBeGreaterThan(0);

    // 3. Clear DB
    await initRDBClient.__forceSyncRDBClient();

    // Verify DB is empty
    const worldLogsAfterClear =
      await worldJoinLogService.findVRChatWorldJoinLogList({
        orderByJoinDateTime: 'asc',
      });
    expect(worldLogsAfterClear.length).toBe(0);

    // 4. Import the exported directory
    const exportedPath = exportResult.exportedFiles[0];
    const exportedDirMatch = exportedPath.match(/vrchat-albums-export_[^/\\]+/);
    if (!exportedDirMatch) {
      throw new Error('Export directory not found in path');
    }
    const exportedDirPath = path.join(testExportDir, exportedDirMatch[0]);

    const importResult = await caller.importLogStoreFiles({
      filePaths: [exportedDirPath],
    });

    expect(importResult.success).toBe(true);
    expect(importResult.importedData.totalLines).toBeGreaterThan(0);
    expect(importResult.importedData.totalLines).toBe(3); // 1 world join + 1 player join + 1 separator line

    // 5. Verify that the import completed successfully
    // Note: The import process only imports raw log lines into logStore,
    // it doesn't recreate the structured database records (that would require log sync)
    expect(importResult.backup).toBeDefined();
    expect(importResult.backup.id).toMatch(/^backup_\d{8}_\d{6}$/);
    expect(importResult.importedData.processedFiles.length).toBe(1);
  });
});
