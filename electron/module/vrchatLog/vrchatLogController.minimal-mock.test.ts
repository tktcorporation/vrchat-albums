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

import { vrchatLogRouter } from './vrchatLogController';

describe('vrchatLogController integration test with minimal mocks', () => {
  let router: ReturnType<typeof vrchatLogRouter>;
  let caller: ReturnType<ReturnType<typeof vrchatLogRouter>['createCaller']>;
  let testExportDir: string;

  beforeAll(async () => {
    // Initialize test database
    initRDBClient.__initTestRDBClient();
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

  /**
   * testUserDataDir/logStore 配下にテスト用logStoreファイルを作成
   */
  const createTestLogStoreFile = async (yearMonth: string, content: string) => {
    const logStoreDir = path.join(testUserDataDir, 'logStore', yearMonth);
    await fs.mkdir(logStoreDir, { recursive: true });
    const filePath = path.join(logStoreDir, `logStore-${yearMonth}.txt`);
    await fs.writeFile(filePath, content, 'utf-8');
    return filePath;
  };

  it('エクスポートしたデータを再インポートできる（実際のサービスを使用）', async () => {
    // 1. Create test logStore files (export copies files directly, not from DB)
    const logContent = [
      '2023.10.15 10:00:00 Log        -  [Behaviour] Joining wrld_12345678-1234-1234-1234-123456789abc:12345',
      '2023.10.15 10:00:00 Log        -  [Behaviour] Joining or Creating Room: Test World',
      '2023.10.15 10:05:00 Log        -  [Behaviour] OnPlayerJoined TestPlayer',
    ].join('\n');
    await createTestLogStoreFile('2023-10', logContent);

    // 2. Export data (copies logStore files directly)
    const exportResult = await caller.exportLogStoreData({
      startDate: new Date('2023-10-01'),
      endDate: new Date('2023-10-31'),
      outputPath: testExportDir,
    });

    expect(exportResult.exportedFiles.length).toBeGreaterThan(0);
    expect(exportResult.totalLogLines).toBeGreaterThan(0);

    // 3. Import the exported directory
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
    expect(importResult.importedData.totalLines).toBe(3);

    // 4. Verify that the import completed successfully
    expect(importResult.backup).toBeDefined();
    expect(importResult.backup.id).toMatch(/^backup_\d{8}_\d{6}$/);
    expect(importResult.importedData.processedFiles.length).toBe(1);
  });
});
