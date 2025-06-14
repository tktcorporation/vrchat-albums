import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { uuidv7 } from 'uuidv7';
import { describe, expect, it } from 'vitest';
import type { LogRecord } from '../converters/dbToLogStore';
import {
  type DBLogProvider,
  type ExportLogStoreOptions,
  exportLogStoreFromDB,
  exportLogStoreToSingleFile,
} from './exportService';

describe('exportService integration', () => {
  // モックDB取得関数（実際のDBに依存しないテスト用）
  const getMockDBLogs: DBLogProvider = async (
    startDate: Date,
    endDate: Date,
  ): Promise<LogRecord[]> => {
    // テスト用のモックデータを返す
    const testDate = new Date('2023-10-08T15:30:45');

    if (testDate >= startDate && testDate <= endDate) {
      return [
        {
          type: 'worldJoin',
          record: {
            id: uuidv7(),
            worldId: 'wrld_12345678-1234-1234-1234-123456789abc',
            worldName: 'Test World',
            worldInstanceId: '12345',
            joinDateTime: testDate,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
        {
          type: 'playerJoin',
          record: {
            id: uuidv7(),
            playerName: 'TestPlayer',
            playerId: 'usr_12345678-1234-1234-1234-123456789abc',
            joinDateTime: new Date(testDate.getTime() + 60000),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
        {
          type: 'playerLeave',
          record: {
            id: uuidv7(),
            playerName: 'TestPlayer',
            playerId: 'usr_12345678-1234-1234-1234-123456789abc',
            leaveDateTime: new Date(testDate.getTime() + 120000),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      ];
    }

    return [];
  };

  it('データベースからのエクスポートが正常に動作する', async () => {
    // 一時ディレクトリを作成
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'logstore-export-test-'),
    );

    try {
      // エクスポート実行
      const options: ExportLogStoreOptions = {
        startDate: new Date('2023-10-08T00:00:00'),
        endDate: new Date('2023-10-08T23:59:59'),
        outputBasePath: tempDir,
      };

      const result = await exportLogStoreFromDB(options, getMockDBLogs);

      // 結果を検証
      expect(result.exportedFiles).toHaveLength(1);
      expect(result.totalLogLines).toBe(4); // worldJoin=2行 + playerJoin=1行 + playerLeave=1行

      const exportedFilePath = result.exportedFiles[0];
      expect(exportedFilePath).toContain('2023-10/logStore-2023-10.txt');

      // ファイルが実際に作成されていることを確認
      const fileExists = await fs
        .access(exportedFilePath)
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(true);

      // ファイル内容を確認
      const fileContent = await fs.readFile(exportedFilePath, 'utf-8');
      const lines = fileContent.split('\n');

      expect(lines).toHaveLength(4);
      expect(lines[0]).toContain(
        '2023.10.08 15:30:45 Log        -  [Behaviour] Joining wrld_',
      );
      expect(lines[1]).toContain(
        '2023.10.08 15:30:45 Log        -  [Behaviour] Joining or Creating Room: Test World',
      );
      expect(lines[2]).toContain(
        '2023.10.08 15:31:45 Log        -  [Behaviour] OnPlayerJoined TestPlayer',
      );
      expect(lines[3]).toContain(
        '2023.10.08 15:32:45 Log        -  [Behaviour] OnPlayerLeft TestPlayer',
      );
    } finally {
      // 一時ディレクトリを削除
      try {
        await fs.rm(tempDir, { recursive: true });
      } catch (_error) {
        // エラーは無視
      }
    }
  });

  it('単一ファイルエクスポートが正常に動作する', async () => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'logstore-export-test-'),
    );

    try {
      const options: ExportLogStoreOptions = {
        startDate: new Date('2023-10-08T00:00:00'),
        endDate: new Date('2023-10-08T23:59:59'),
      };

      const outputFilePath = path.join(tempDir, 'single-export.txt');
      const result = await exportLogStoreToSingleFile(
        options,
        getMockDBLogs,
        outputFilePath,
      );

      expect(result.exportedFiles).toHaveLength(1);
      expect(result.exportedFiles[0]).toBe(outputFilePath);
      expect(result.totalLogLines).toBe(4);

      // ファイル内容を確認
      const fileContent = await fs.readFile(outputFilePath, 'utf-8');
      expect(fileContent).toContain('Test World');
    } finally {
      try {
        await fs.rm(tempDir, { recursive: true });
      } catch (_error) {
        // エラーは無視
      }
    }
  });

  it('データが存在しない場合は空の結果を返す', async () => {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'logstore-export-test-'),
    );

    try {
      const options: ExportLogStoreOptions = {
        startDate: new Date('2020-01-01T00:00:00'),
        endDate: new Date('2020-01-01T23:59:59'),
        outputBasePath: tempDir,
      };

      const result = await exportLogStoreFromDB(options, getMockDBLogs);

      expect(result.exportedFiles).toHaveLength(0);
      expect(result.totalLogLines).toBe(0);
    } finally {
      try {
        await fs.rm(tempDir, { recursive: true });
      } catch (_error) {
        // エラーは無視
      }
    }
  });
});
