import * as nodeFs from 'node:fs';
import * as nodeFsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { app } from 'electron';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importService } from '../vrchatLog/importService/importService';
import * as migrationService from './service';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(),
  },
}));

vi.mock('../../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../vrchatWorldJoinLog/service', () => ({
  findVRChatWorldJoinLogList: vi.fn().mockResolvedValue([]),
}));

vi.mock('../vrchatLog/importService/importService', () => ({
  importService: {
    importLogStoreFiles: vi.fn(),
  },
}));

describe('migration service integration', () => {
  let testDir: string;
  let mockCurrentAppPath: string;
  let mockOldAppPath: string;

  beforeEach(async () => {
    // Clear migration cache before each test
    migrationService.clearMigrationCache();

    // Create temporary test directories
    testDir = path.join(tmpdir(), `migration-test-${Date.now()}`);
    mockOldAppPath = path.join(testDir, 'vrchat-photo-journey');
    mockCurrentAppPath = path.join(testDir, 'vrchat-albums');

    await nodeFsPromises.mkdir(mockOldAppPath, { recursive: true });
    await nodeFsPromises.mkdir(mockCurrentAppPath, { recursive: true });

    vi.mocked(app.getPath).mockReturnValue(mockCurrentAppPath);
  });

  afterEach(async () => {
    // Clean up test directories
    await nodeFsPromises.rm(testDir, { recursive: true, force: true });
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('isMigrationNeeded', () => {
    it('should return false if old app directory does not exist', async () => {
      // Remove the old app directory
      await nodeFsPromises.rm(mockOldAppPath, { recursive: true, force: true });

      const resultAsync = await migrationService.isMigrationNeeded();
      expect(resultAsync._unsafeUnwrap()).toBe(false);
    });

    it('should return false if migration marker already exists', async () => {
      // Create migration marker
      const markerPath = path.join(mockCurrentAppPath, '.migration-completed');
      await nodeFsPromises.writeFile(markerPath, '{}');

      const resultAsync = await migrationService.isMigrationNeeded();
      expect(resultAsync._unsafeUnwrap()).toBe(false);
    });

    it('should return true if migration is needed', async () => {
      const resultAsync = await migrationService.isMigrationNeeded();
      expect(resultAsync._unsafeUnwrap()).toBe(true);
    });

    it('should detect old app with alternate directory name (VRChatPhotoJourney)', async () => {
      // Remove the default old app directory
      await nodeFsPromises.rm(mockOldAppPath, { recursive: true, force: true });

      // Create alternate directory name
      const alternateOldAppPath = path.join(testDir, 'VRChatPhotoJourney');
      await nodeFsPromises.mkdir(alternateOldAppPath, { recursive: true });

      const resultAsync = await migrationService.isMigrationNeeded();
      expect(resultAsync._unsafeUnwrap()).toBe(true);
    });
  });

  describe('performMigration', () => {
    it('should successfully migrate all data when all files exist', async () => {
      // Create test files in old app directory
      await nodeFsPromises.writeFile(
        path.join(mockOldAppPath, 'config.json'),
        '{"key": "value"}',
      );

      const logStorePath = path.join(mockOldAppPath, 'logStore');
      await nodeFsPromises.mkdir(logStorePath, { recursive: true });
      await nodeFsPromises.writeFile(
        path.join(logStorePath, 'logStore-2024-01.txt'),
        '2024-01-15T10:00:00.000000+09:00\tlog content',
      );

      // Mock successful import
      vi.mocked(importService.importLogStoreFiles).mockResolvedValue(
        ok({
          success: true,
          backup: {
            id: 'backup-123',
            backupTimestamp: new Date(),
            exportFolderPath: '/path/to/export',
            sourceFiles: [],
            status: 'completed' as const,
            importTimestamp: new Date(),
            totalLogLines: 1,
            exportedFiles: [],
          },
          importedData: {
            logLines: [],
            totalLines: 1,
            processedFiles: [path.join(logStorePath, 'logStore-2024-01.txt')],
          },
        }),
      );

      const result = await migrationService.performMigration();

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({
        migrated: true,
        details: {
          database: false, // No longer migrating database
          logStore: true,
          settings: true,
        },
        errors: [],
      });

      // Verify importService was called
      expect(importService.importLogStoreFiles).toHaveBeenCalledWith(
        [logStorePath],
        expect.any(Function),
      );

      // Verify settings were copied
      expect(
        nodeFs.existsSync(path.join(mockCurrentAppPath, 'config.json')),
      ).toBe(true);
    });

    it('should handle partial migration when some files are missing', async () => {
      // Only create settings file (no logStore)
      await nodeFsPromises.writeFile(
        path.join(mockOldAppPath, 'config.json'),
        '{"key": "value"}',
      );

      const result = await migrationService.performMigration();

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({
        migrated: true,
        details: {
          database: false,
          logStore: false,
          settings: true,
        },
        errors: [],
      });
    });

    it('should create migration marker on successful migration', async () => {
      // Create at least one file to migrate
      await nodeFsPromises.writeFile(
        path.join(mockOldAppPath, 'config.json'),
        '{"key": "value"}',
      );

      const result = await migrationService.performMigration();

      expect(result.isOk()).toBe(true);

      const markerPath = path.join(mockCurrentAppPath, '.migration-completed');
      expect(nodeFs.existsSync(markerPath)).toBe(true);

      const markerContent = await nodeFsPromises.readFile(markerPath, 'utf-8');
      const marker = JSON.parse(markerContent);
      expect(marker.fromApp).toBe('vrchat-photo-journey');
      expect(marker.toApp).toBe('VRChatAlbums');
    });

    it('should handle import errors gracefully', async () => {
      // Create logStore directory
      const logStorePath = path.join(mockOldAppPath, 'logStore');
      await nodeFsPromises.mkdir(logStorePath, { recursive: true });
      await nodeFsPromises.writeFile(
        path.join(logStorePath, 'logStore-2024-01.txt'),
        'log content',
      );

      // Mock import failure
      vi.mocked(importService.importLogStoreFiles).mockResolvedValue(
        err(new Error('Import failed')),
      );

      const result = await migrationService.performMigration();

      expect(result.isOk()).toBe(true);
      const migrationResult = result._unsafeUnwrap();
      expect(migrationResult.errors).toContain(
        'LogStore import failed: Import failed',
      );
      expect(migrationResult.details.logStore).toBe(false);
    });

    it('should use importService for logStore migration', async () => {
      // Create logStore with nested structure
      const logStorePath = path.join(mockOldAppPath, 'logStore');
      const nestedPath = path.join(logStorePath, '2024-01');
      await nodeFsPromises.mkdir(nestedPath, { recursive: true });
      await nodeFsPromises.writeFile(
        path.join(nestedPath, 'logStore-2024-01.txt'),
        '2024-01-15T10:00:00.000000+09:00\tlog content',
      );

      // Mock successful import
      vi.mocked(importService.importLogStoreFiles).mockResolvedValue(
        ok({
          success: true,
          backup: {
            id: 'backup-123',
            backupTimestamp: new Date(),
            exportFolderPath: '/path/to/export',
            sourceFiles: [],
            status: 'completed' as const,
            importTimestamp: new Date(),
            totalLogLines: 1,
            exportedFiles: [],
          },
          importedData: {
            logLines: [],
            totalLines: 1,
            processedFiles: [path.join(nestedPath, 'logStore-2024-01.txt')],
          },
        }),
      );

      const result = await migrationService.performMigration();

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().details.logStore).toBe(true);

      // Verify importService was called with the logStore directory
      expect(importService.importLogStoreFiles).toHaveBeenCalledWith(
        [logStorePath],
        expect.any(Function),
      );
    });
  });

  describe('performMigrationIfNeeded', () => {
    it('should perform migration when needed', async () => {
      // Create test files
      await nodeFsPromises.writeFile(
        path.join(mockOldAppPath, 'config.json'),
        '{"key": "value"}',
      );

      // Mock successful import
      vi.mocked(importService.importLogStoreFiles).mockResolvedValue(
        ok({
          success: true,
          backup: {
            id: 'backup-123',
            backupTimestamp: new Date(),
            exportFolderPath: '/path/to/export',
            sourceFiles: [],
            status: 'completed' as const,
            importTimestamp: new Date(),
            totalLogLines: 0,
            exportedFiles: [],
          },
          importedData: {
            logLines: [],
            totalLines: 0,
            processedFiles: [],
          },
        }),
      );

      await migrationService.performMigrationIfNeeded();

      // Verify migration marker was created
      const markerPath = path.join(mockCurrentAppPath, '.migration-completed');
      expect(nodeFs.existsSync(markerPath)).toBe(true);
    });

    it('should skip migration when not needed', async () => {
      // Create migration marker
      const markerPath = path.join(mockCurrentAppPath, '.migration-completed');
      await nodeFsPromises.writeFile(markerPath, '{}');

      await migrationService.performMigrationIfNeeded();

      // Verify importService was not called
      expect(importService.importLogStoreFiles).not.toHaveBeenCalled();
    });

    it('should continue app startup even if migration fails', async () => {
      // Create test files
      const logStorePath = path.join(mockOldAppPath, 'logStore');
      await nodeFsPromises.mkdir(logStorePath, { recursive: true });

      // Mock import failure
      vi.mocked(importService.importLogStoreFiles).mockResolvedValue(
        err(new Error('Critical failure')),
      );

      // Should succeed (Result type with void value)
      const result = await migrationService.performMigrationIfNeeded();
      expect(result.isOk()).toBe(true);
    });
  });
});
