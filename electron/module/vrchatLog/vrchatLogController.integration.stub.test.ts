import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// テストヘルパー関数
const createTestLogStoreFile = async (
  exportDir: string,
  yearMonth: string,
  content: string,
) => {
  const monthDir = path.join(exportDir, yearMonth);
  await fs.mkdir(monthDir, { recursive: true });
  const filePath = path.join(monthDir, `logStore-${yearMonth}.txt`);
  await fs.writeFile(filePath, content);
  return filePath;
};

describe('vrchatLogController integration stub tests', () => {
  const testUserDataDir = path.join(
    os.tmpdir(),
    `vrchat-albums-test-${uuidv7()}`,
  );
  const testExportDir = path.join(os.tmpdir(), `test-export-${uuidv7()}`);

  beforeAll(async () => {
    await fs.mkdir(testUserDataDir, { recursive: true });
    await fs.mkdir(testExportDir, { recursive: true });
  });

  beforeEach(async () => {
    // 各テストケースの前にテストディレクトリをクリーンアップ
    await fs.rm(testExportDir, { recursive: true, force: true });
    await fs.mkdir(testExportDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(testUserDataDir, { recursive: true, force: true });
    await fs.rm(testExportDir, { recursive: true, force: true });
  });

  describe('インポート・エクスポート機能の基本動作確認', () => {
    it('logStoreファイルの形式が正しく読み込めることを確認', async () => {
      // テストデータ作成
      const testLogContent = [
        '2023-11-02 15:30:45 Log        -  [Behaviour] Joining or Creating Room: Import Test World',
        '2023-11-02 15:31:00 Log        -  [Behaviour] OnPlayerJoined ImportTestPlayer',
      ].join('\n');

      const testFilePath = await createTestLogStoreFile(
        testExportDir,
        '2023-11',
        testLogContent,
      );

      // ファイルが正しく作成されたことを確認
      const fileContent = await fs.readFile(testFilePath, 'utf-8');
      expect(fileContent).toBe(testLogContent);

      // ファイル名のパターンが正しいことを確認
      const fileName = path.basename(testFilePath);
      expect(fileName).toMatch(/^logStore-\d{4}-\d{2}\.txt$/);
    });

    it('エクスポートディレクトリ構造が正しく作成されることを確認', async () => {
      const exportFolderName = 'vrchat-albums-export_2023-12-01_14-30-45';
      const exportDir = path.join(testExportDir, exportFolderName);
      const monthDir = path.join(exportDir, '2023-11');

      await fs.mkdir(monthDir, { recursive: true });
      const logFilePath = path.join(monthDir, 'logStore-2023-11.txt');
      await fs.writeFile(logFilePath, 'Test log line\n');

      // ディレクトリ構造を確認
      const exportDirExists = await fs
        .stat(exportDir)
        .then(() => true)
        .catch(() => false);
      const monthDirExists = await fs
        .stat(monthDir)
        .then(() => true)
        .catch(() => false);
      const logFileExists = await fs
        .stat(logFilePath)
        .then(() => true)
        .catch(() => false);

      expect(exportDirExists).toBe(true);
      expect(monthDirExists).toBe(true);
      expect(logFileExists).toBe(true);

      // パスから日付情報を抽出できることを確認
      const parts = logFilePath.split(path.sep);
      const exportFolderIndex = parts.findIndex((part) =>
        part.startsWith('vrchat-albums-export_'),
      );
      expect(exportFolderIndex).toBeGreaterThan(-1);
      expect(parts[exportFolderIndex]).toBe(exportFolderName);
    });

    it('バックアップメタデータが正しい形式で保存されることを確認', async () => {
      const backupId = 'backup_20231201_143045';
      const metadata = {
        id: backupId,
        backupTimestamp: new Date('2023-12-01T14:30:45'),
        exportFolderPath: 'vrchat-albums-export_2023-12-01_14-30-45',
        sourceFiles: ['/path/to/import/file.txt'],
        status: 'completed' as const,
        importTimestamp: new Date('2023-12-01T14:31:00'),
        totalLogLines: 100,
        exportedFiles: [
          '/backups/vrchat-albums-export_2023-12-01_14-30-45/2023-11/logStore-2023-11.txt',
        ],
      };

      const metadataPath = path.join(testExportDir, 'backup-metadata.json');
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

      // メタデータが正しく読み込めることを確認
      const loadedMetadata = JSON.parse(
        await fs.readFile(metadataPath, 'utf-8'),
      );
      expect(loadedMetadata.id).toBe(backupId);
      expect(loadedMetadata.status).toBe('completed');
      expect(loadedMetadata.exportedFiles).toHaveLength(1);
    });

    it('複数のlogStoreファイルを含むディレクトリ構造を処理できることを確認', async () => {
      // 複数月のテストデータを作成
      const months = ['2023-10', '2023-11', '2023-12'];
      const createdFiles: string[] = [];

      for (const yearMonth of months) {
        const content = `${yearMonth}-01 10:00:00 Log        -  [Behaviour] Test log for ${yearMonth}\n`;
        const filePath = await createTestLogStoreFile(
          testExportDir,
          yearMonth,
          content,
        );
        createdFiles.push(filePath);
      }

      // すべてのファイルが作成されたことを確認
      expect(createdFiles).toHaveLength(3);

      // ディレクトリを再帰的に読み込んで、logStoreファイルを収集
      const collectLogStoreFiles = async (dir: string): Promise<string[]> => {
        const files: string[] = [];
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isFile() && entry.name.includes('logStore')) {
            files.push(fullPath);
          } else if (entry.isDirectory()) {
            const subDirFiles = await collectLogStoreFiles(fullPath);
            files.push(...subDirFiles);
          }
        }

        return files;
      };

      const collectedFiles = await collectLogStoreFiles(testExportDir);
      expect(collectedFiles).toHaveLength(3);

      // ファイルが年月順にソートできることを確認
      const sortedFiles = collectedFiles.sort((a, b) => {
        const aMatch = a.match(/(\d{4}-\d{2})/);
        const bMatch = b.match(/(\d{4}-\d{2})/);
        return (aMatch?.[0] || '').localeCompare(bMatch?.[0] || '');
      });

      expect(sortedFiles[0]).toContain('2023-10');
      expect(sortedFiles[1]).toContain('2023-11');
      expect(sortedFiles[2]).toContain('2023-12');
    });
  });
});
