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

  /**
   * エクスポート結果からエクスポートディレクトリパスを取得
   */
  const getExportDirPath = (exportResult: {
    exportedFiles: string[];
  }): string => {
    const exportedPath = exportResult.exportedFiles[0];
    const exportedDirMatch = exportedPath.match(/vrchat-albums-export_[^/\\]+/);
    if (!exportedDirMatch) {
      throw new Error('Export directory not found in path');
    }
    return path.join(testExportDir, exportedDirMatch[0]);
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
    const exportedDirPath = getExportDirPath(exportResult);

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

  it('E2Eラウンドトリップ: エクスポート→logStoreクリア→インポートで内容が保持される', async () => {
    // 1. テスト用logStoreファイルを作成
    const logLines = [
      '2023.10.15 10:00:00 Log        -  [Behaviour] Joining wrld_12345678-1234-1234-1234-123456789abc:12345',
      '2023.10.15 10:00:00 Log        -  [Behaviour] Joining or Creating Room: Test World',
      '2023.10.15 10:05:00 Log        -  [Behaviour] OnPlayerJoined TestPlayer',
    ];
    const logContent = logLines.join('\n');
    await createTestLogStoreFile('2023-10', logContent);

    // 2. エクスポート
    const exportResult = await caller.exportLogStoreData({
      startDate: new Date('2023-10-01'),
      endDate: new Date('2023-10-31'),
      outputPath: testExportDir,
    });

    expect(exportResult.exportedFiles.length).toBe(1);
    expect(exportResult.totalLogLines).toBe(3);

    // 3. エクスポートされたファイルの内容がオリジナルと一致
    const exportedContent = await fs.readFile(
      exportResult.exportedFiles[0],
      'utf-8',
    );
    expect(exportedContent).toBe(logContent);

    // 4. オリジナルのlogStoreディレクトリを削除
    const logStoreDir = path.join(testUserDataDir, 'logStore');
    await fs.rm(logStoreDir, { recursive: true, force: true });

    // 5. エクスポートからインポート
    const exportedDirPath = getExportDirPath(exportResult);
    const importResult = await caller.importLogStoreFiles({
      filePaths: [exportedDirPath],
    });

    expect(importResult.success).toBe(true);
    expect(importResult.importedData.totalLines).toBe(3);

    // 6. インポート後のlogStoreファイルの内容が元のログ行を含むことを検証
    const importedLogStorePath = path.join(
      testUserDataDir,
      'logStore',
      '2023-10',
      'logStore-2023-10.txt',
    );
    const importedContent = await fs.readFile(importedLogStorePath, 'utf-8');

    // appendLoglinesToFile は改行で終わるフォーマットを使用するため、各行が含まれることを確認
    for (const line of logLines) {
      expect(importedContent).toContain(line);
    }
  });

  it('マニフェスト付きエクスポートのインポートが正常に動作する', async () => {
    // 1. テスト用logStoreファイルを作成
    const logContent = [
      '2023.10.15 10:00:00 Log        -  [Behaviour] Joining wrld_12345678-1234-1234-1234-123456789abc:12345',
      '2023.10.15 10:00:00 Log        -  [Behaviour] Joining or Creating Room: Test World',
    ].join('\n');
    await createTestLogStoreFile('2023-10', logContent);

    // 2. エクスポート（マニフェスト付き）
    const exportResult = await caller.exportLogStoreData({
      startDate: new Date('2023-10-01'),
      endDate: new Date('2023-10-31'),
      outputPath: testExportDir,
    });

    // マニフェストが存在することを確認
    expect(exportResult.manifestPath).toBeTruthy();
    const manifestExists = await fs
      .access(exportResult.manifestPath)
      .then(() => true)
      .catch(() => false);
    expect(manifestExists).toBe(true);

    // 3. マニフェスト内容を確認
    const manifestContent = JSON.parse(
      await fs.readFile(exportResult.manifestPath, 'utf-8'),
    );
    expect(manifestContent.version).toBe(1);
    expect(manifestContent.status).toBe('completed');
    expect(manifestContent.totalLogLines).toBe(2);

    // 4. マニフェスト付きディレクトリからインポート
    const exportedDirPath = getExportDirPath(exportResult);
    const importResult = await caller.importLogStoreFiles({
      filePaths: [exportedDirPath],
    });

    expect(importResult.success).toBe(true);
    expect(importResult.importedData.totalLines).toBe(2);
  });

  it('マニフェストのrelativePathがPOSIX形式で保存される', async () => {
    const logContent =
      '2023.10.15 10:00:00 Log        -  [Behaviour] Joining wrld_12345678-1234-1234-1234-123456789abc:12345';
    await createTestLogStoreFile('2023-10', logContent);

    const exportResult = await caller.exportLogStoreData({
      startDate: new Date('2023-10-01'),
      endDate: new Date('2023-10-31'),
      outputPath: testExportDir,
    });

    // エクスポートされたファイルパスがOS固有の正規化済みであること
    for (const exportedFile of exportResult.exportedFiles) {
      expect(exportedFile).toBe(path.normalize(exportedFile));
    }

    // マニフェストの relativePath がPOSIX形式（バックスラッシュなし）
    const manifestContent = JSON.parse(
      await fs.readFile(exportResult.manifestPath, 'utf-8'),
    ) as { files: Array<{ relativePath: string }> };
    for (const file of manifestContent.files) {
      expect(file.relativePath).not.toContain('\\');
    }
  });
});
