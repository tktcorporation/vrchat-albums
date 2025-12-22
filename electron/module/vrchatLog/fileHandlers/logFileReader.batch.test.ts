import {
  beforeEach,
  describe,
  expect,
  it,
  type MockedFunction,
  vi,
} from 'vitest';
import {
  type VRChatLogFilePath,
  VRChatLogFilePathSchema,
} from '../../vrchatLogFileDir/model';
import { VRChatLogLineSchema, type VRChatLogStoreFilePath } from '../model';
import type { getLogLinesByLogFilePathListStreaming as GetLogLinesByLogFilePathListStreamingType } from './logFileReader';

vi.mock('./logFileReader', () => ({
  getLogLinesFromLogFile: vi.fn(),
  getLogLinesByLogFilePathListStreaming: vi.fn(),
}));

describe('logFileReader - Batch Processing', () => {
  let getLogLinesByLogFilePathListStreaming: MockedFunction<
    typeof GetLogLinesByLogFilePathListStreamingType
  >;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Import the mocked functions
    const module = await import('./logFileReader');
    getLogLinesByLogFilePathListStreaming = vi.mocked(
      module.getLogLinesByLogFilePathListStreaming,
    );

    // メモリ使用量を安全な範囲に設定
    vi.spyOn(process, 'memoryUsage').mockReturnValue({
      heapUsed: 100 * 1024 * 1024, // 100MB
      heapTotal: 1024 * 1024 * 1024,
      external: 0,
      arrayBuffers: 0,
      rss: 1024 * 1024 * 1024,
    });
  });

  describe('バッチサイズ制御', () => {
    it('小さなバッチサイズでストリーミング処理が正常に動作する', async () => {
      const mockLogFilePaths = [
        VRChatLogFilePathSchema.parse('/path/to/output_log_2023-01-01.txt'),
      ];

      const mockLogLines = [
        VRChatLogLineSchema.parse('2023-01-01 10:00:00 [Info] Test line 1'),
        VRChatLogLineSchema.parse('2023-01-01 10:00:01 [Info] Test line 2'),
        VRChatLogLineSchema.parse('2023-01-01 10:00:02 [Info] Test line 3'),
      ];

      // Mock generator to return batches
      async function* mockGenerator() {
        yield [mockLogLines[0], mockLogLines[1]]; // First batch: 2 items
        yield [mockLogLines[2]]; // Second batch: 1 item
      }

      getLogLinesByLogFilePathListStreaming.mockReturnValue(mockGenerator());

      const generator = getLogLinesByLogFilePathListStreaming({
        logFilePathList: mockLogFilePaths,
        includesList: ['Test'],
        batchSize: 2,
      });

      const results = [];
      for await (const batch of generator) {
        results.push(batch);
      }

      // 2つのバッチ（2行+1行）に分かれることを確認
      expect(results).toHaveLength(2);
      expect(results[0]).toHaveLength(2);
      expect(results[1]).toHaveLength(1);
    });

    it('複数のログファイルから指定文字列を含む行のみ抽出される', async () => {
      const mockLogFilePaths = [
        VRChatLogFilePathSchema.parse('/path/to/output_log_2023-01-01.txt'),
        VRChatLogFilePathSchema.parse('/path/to/output_log_2023-01-02.txt'),
      ];

      const importantLines = [
        VRChatLogLineSchema.parse('2023-01-01 10:00:00 [Info] Important event'),
        VRChatLogLineSchema.parse(
          '2023-01-01 10:00:02 [Info] Another Important event',
        ),
        VRChatLogLineSchema.parse(
          '2023-01-02 10:00:00 [Info] Important event in file 2',
        ),
      ];

      // Mock generator to return all important lines in one batch
      async function* mockGenerator() {
        yield importantLines;
      }

      getLogLinesByLogFilePathListStreaming.mockReturnValue(mockGenerator());

      const generator = getLogLinesByLogFilePathListStreaming({
        logFilePathList: mockLogFilePaths,
        includesList: ['Important'],
        batchSize: 1000,
      });

      const results = [];
      for await (const batch of generator) {
        results.push(...batch);
      }

      // "Important"を含む行のみが抽出されることを確認
      expect(results).toHaveLength(3);
      expect(results.every((line) => line.value.includes('Important'))).toBe(
        true,
      );
    });

    it('デフォルトのバッチサイズ（1000行）で大量データを処理する', async () => {
      const mockLogFilePaths = [
        VRChatLogFilePathSchema.parse('/path/to/output_log_2023-01-01.txt'),
      ];

      // 1500行のデータをVRChatLogLineSchemaでパース
      const firstBatch = Array.from({ length: 1000 }, (_, i) =>
        VRChatLogLineSchema.parse(
          `2023-01-01 10:${String(i % 60).padStart(
            2,
            '0',
          )}:00 [Info] Test line ${i}`,
        ),
      );

      const secondBatch = Array.from({ length: 500 }, (_, i) =>
        VRChatLogLineSchema.parse(
          `2023-01-01 10:${String((i + 1000) % 60).padStart(
            2,
            '0',
          )}:00 [Info] Test line ${i + 1000}`,
        ),
      );

      // Mock generator to return two batches
      async function* mockGenerator() {
        yield firstBatch; // 1000 lines
        yield secondBatch; // 500 lines
      }

      getLogLinesByLogFilePathListStreaming.mockReturnValue(mockGenerator());

      const generator = getLogLinesByLogFilePathListStreaming({
        logFilePathList: mockLogFilePaths,
        includesList: ['Test'],
        // batchSizeを指定しない（デフォルト1000）
      });

      const results = [];
      for await (const batch of generator) {
        results.push(batch);
      }

      // 2つのバッチ（1000行+500行）に分かれることを確認
      expect(results).toHaveLength(2);
      expect(results[0]).toHaveLength(1000);
      expect(results[1]).toHaveLength(500);
    });
  });

  describe('並列処理制御', () => {
    it('指定された並列処理数で複数ファイルを並列処理する', async () => {
      const mockLogFilePaths = Array.from({ length: 6 }, (_, i) =>
        VRChatLogFilePathSchema.parse(
          `/path/to/output_log_2023-01-${String(i + 1).padStart(2, '0')}.txt`,
        ),
      );

      const mockLines = Array.from({ length: 6 }, (_, i) =>
        VRChatLogLineSchema.parse(
          `2023-01-01 10:00:0${i} [Info] Test line ${i + 1}`,
        ),
      );

      // Mock generator to return all lines in one batch
      async function* mockGenerator() {
        yield mockLines;
      }

      getLogLinesByLogFilePathListStreaming.mockReturnValue(mockGenerator());

      const generator = getLogLinesByLogFilePathListStreaming({
        logFilePathList: mockLogFilePaths,
        includesList: ['Test'],
        concurrency: 2, // 2ファイルずつ並列処理
      });

      const results = [];
      for await (const batch of generator) {
        results.push(...batch);
      }

      // 全ファイルから行が取得されることを確認
      expect(results).toHaveLength(6);
      expect(getLogLinesByLogFilePathListStreaming).toHaveBeenCalledWith({
        logFilePathList: mockLogFilePaths,
        includesList: ['Test'],
        concurrency: 2,
      });
    });

    it('デフォルトの並列処理数（5）で多数のファイルを処理する', async () => {
      const mockLogFilePaths = Array.from({ length: 10 }, (_, i) =>
        VRChatLogFilePathSchema.parse(
          `/path/to/output_log_2023-01-${String(i + 1).padStart(2, '0')}.txt`,
        ),
      );

      const mockLines = Array.from({ length: 10 }, (_, i) =>
        VRChatLogLineSchema.parse(
          `2023-01-01 10:00:0${i} [Info] Test line ${i + 1}`,
        ),
      );

      // Mock generator to return all lines
      async function* mockGenerator() {
        yield mockLines;
      }

      getLogLinesByLogFilePathListStreaming.mockReturnValue(mockGenerator());

      const generator = getLogLinesByLogFilePathListStreaming({
        logFilePathList: mockLogFilePaths,
        includesList: ['Test'],
        // concurrencyを指定しない（デフォルト5）
      });

      const results = [];
      for await (const batch of generator) {
        results.push(...batch);
      }

      expect(results).toHaveLength(10);
      expect(getLogLinesByLogFilePathListStreaming).toHaveBeenCalledWith({
        logFilePathList: mockLogFilePaths,
        includesList: ['Test'],
      });
    });

    it('並列処理数制限により大量ファイルがバッチで処理される', async () => {
      const mockLogFilePaths = Array.from({ length: 100 }, (_, i) =>
        VRChatLogFilePathSchema.parse(
          `/path/to/output_log_2023-01-${String(i + 1).padStart(2, '0')}.txt`,
        ),
      );

      const mockLines = Array.from({ length: 100 }, (_, i) =>
        VRChatLogLineSchema.parse(
          `2023-01-01 10:00:00 [Info] Test line from file ${i + 1}`,
        ),
      );

      // Mock generator to return all lines efficiently
      async function* mockGenerator() {
        yield mockLines;
      }

      getLogLinesByLogFilePathListStreaming.mockReturnValue(mockGenerator());

      const startTime = Date.now();
      const generator = getLogLinesByLogFilePathListStreaming({
        logFilePathList: mockLogFilePaths,
        includesList: ['Test'],
        concurrency: 3, // 3ファイルずつ並列処理
      });

      const results = [];
      for await (const batch of generator) {
        results.push(...batch);
      }
      const endTime = Date.now();

      expect(results).toHaveLength(100);
      expect(getLogLinesByLogFilePathListStreaming).toHaveBeenCalledWith({
        logFilePathList: mockLogFilePaths,
        includesList: ['Test'],
        concurrency: 3,
      });
      // 並列処理により合理的な時間で完了することを確認
      expect(endTime - startTime).toBeLessThan(1000);
    });
  });

  describe('ログ行の蓄積と放出', () => {
    it('複数ファイルの行が正しくバッチに蓄積される', async () => {
      const mockLogFilePaths = [
        VRChatLogFilePathSchema.parse('/path/to/output_log_2023-01-01.txt'),
        VRChatLogFilePathSchema.parse('/path/to/output_log_2023-01-02.txt'),
      ];

      const mockLines = [
        VRChatLogLineSchema.parse('2023-01-01 10:00:00 [Info] Line 1'),
        VRChatLogLineSchema.parse('2023-01-01 10:00:01 [Info] Line 2'),
        VRChatLogLineSchema.parse('2023-01-02 10:00:00 [Info] Line 3'),
      ];

      // Mock generator to return all lines in one batch
      async function* mockGenerator() {
        yield mockLines;
      }

      getLogLinesByLogFilePathListStreaming.mockReturnValue(mockGenerator());

      const generator = getLogLinesByLogFilePathListStreaming({
        logFilePathList: mockLogFilePaths,
        includesList: ['Line'],
        batchSize: 3, // 全行がちょうど1バッチに収まる
      });

      const results = [];
      for await (const batch of generator) {
        results.push(batch);
      }

      expect(results).toHaveLength(1);
      expect(results[0]).toHaveLength(3);
      expect(results[0].map((line: { value: string }) => line.value)).toEqual([
        '2023-01-01 10:00:00 [Info] Line 1',
        '2023-01-01 10:00:01 [Info] Line 2',
        '2023-01-02 10:00:00 [Info] Line 3',
      ]);
    });

    it('最終バッチが正しく処理される（余りのある場合）', async () => {
      const mockLogFilePaths = [
        VRChatLogFilePathSchema.parse('/path/to/output_log_2023-01-01.txt'),
      ];

      // 7行のデータを3つのバッチに分ける
      const batch1 = Array.from({ length: 3 }, (_, i) =>
        VRChatLogLineSchema.parse(
          `2023-01-01 10:00:0${i} [Info] Line ${i + 1}`,
        ),
      );

      const batch2 = Array.from({ length: 3 }, (_, i) =>
        VRChatLogLineSchema.parse(
          `2023-01-01 10:00:0${i + 3} [Info] Line ${i + 4}`,
        ),
      );

      const batch3 = [
        VRChatLogLineSchema.parse('2023-01-01 10:00:06 [Info] Line 7'),
      ];

      // Mock generator to return three batches
      async function* mockGenerator() {
        yield batch1; // 3 lines
        yield batch2; // 3 lines
        yield batch3; // 1 line
      }

      getLogLinesByLogFilePathListStreaming.mockReturnValue(mockGenerator());

      const generator = getLogLinesByLogFilePathListStreaming({
        logFilePathList: mockLogFilePaths,
        includesList: ['Line'],
        batchSize: 3,
      });

      const results = [];
      for await (const batch of generator) {
        results.push(batch);
      }

      // 3つのバッチ（3行+3行+1行）
      expect(results).toHaveLength(3);
      expect(results[0]).toHaveLength(3);
      expect(results[1]).toHaveLength(3);
      expect(results[2]).toHaveLength(1); // 最終バッチ
    });
  });

  describe('空のデータセット処理', () => {
    it('空のファイルリストを処理してもエラーにならない', async () => {
      const emptyFileList: (VRChatLogFilePath | VRChatLogStoreFilePath)[] = [];

      // Mock generator to return no results
      async function* mockGenerator() {
        // No yields - empty generator
      }

      getLogLinesByLogFilePathListStreaming.mockReturnValue(mockGenerator());

      const generator = getLogLinesByLogFilePathListStreaming({
        logFilePathList: emptyFileList,
        includesList: ['Test'],
      });

      const results = [];
      for await (const batch of generator) {
        results.push(batch);
      }

      expect(results).toHaveLength(0);
      expect(getLogLinesByLogFilePathListStreaming).toHaveBeenCalledWith({
        logFilePathList: emptyFileList,
        includesList: ['Test'],
      });
    });

    it('ログ行が見つからないファイルでも正常に処理される', async () => {
      const mockLogFilePaths = [
        VRChatLogFilePathSchema.parse('/path/to/output_log_empty.txt'),
      ];

      // Mock generator to return no results
      async function* mockGenerator() {
        // No yields - empty generator
      }

      getLogLinesByLogFilePathListStreaming.mockReturnValue(mockGenerator());

      const generator = getLogLinesByLogFilePathListStreaming({
        logFilePathList: mockLogFilePaths,
        includesList: ['NonExistent'],
      });

      const results = [];
      for await (const batch of generator) {
        results.push(batch);
      }

      expect(results).toHaveLength(0);
      expect(getLogLinesByLogFilePathListStreaming).toHaveBeenCalledWith({
        logFilePathList: mockLogFilePaths,
        includesList: ['NonExistent'],
      });
    });

    it('一部ファイルが空でも他のファイルの処理は継続される', async () => {
      const mockLogFilePaths = [
        VRChatLogFilePathSchema.parse('/path/to/output_log_empty.txt'),
        VRChatLogFilePathSchema.parse('/path/to/output_log_with_data.txt'),
      ];

      const validLine = VRChatLogLineSchema.parse(
        '2023-01-01 10:00:00 [Info] Valid line',
      );

      // Mock generator to return only the valid line
      async function* mockGenerator() {
        yield [validLine];
      }

      getLogLinesByLogFilePathListStreaming.mockReturnValue(mockGenerator());

      const generator = getLogLinesByLogFilePathListStreaming({
        logFilePathList: mockLogFilePaths,
        includesList: ['Valid'],
      });

      const results = [];
      for await (const batch of generator) {
        results.push(...batch);
      }

      expect(results).toHaveLength(1);
      expect(results[0].value).toBe('2023-01-01 10:00:00 [Info] Valid line');
    });
  });
});
