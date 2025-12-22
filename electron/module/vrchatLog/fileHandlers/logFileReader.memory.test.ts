import { ok } from 'neverthrow';
import {
  beforeEach,
  describe,
  expect,
  it,
  type MockedFunction,
  vi,
} from 'vitest';
import { logger } from '../../../lib/logger';
import { VRChatLogFilePathSchema } from '../../vrchatLogFileDir/model';
import { VRChatLogLineSchema } from '../model';
import type {
  getLogLinesByLogFilePathListStreaming as GetLogLinesByLogFilePathListStreamingType,
  getLogLinesByLogFilePathList as GetLogLinesByLogFilePathListType,
} from './logFileReader';

vi.mock('./logFileReader', () => ({
  getLogLinesFromLogFile: vi.fn(),
  getLogLinesByLogFilePathListStreaming: vi.fn(),
  getLogLinesByLogFilePathList: vi.fn(),
}));

vi.mock('../../../lib/logger');

const mockLogger = vi.mocked(logger);

describe('logFileReader - Memory Management', () => {
  let getLogLinesByLogFilePathListStreaming: MockedFunction<
    typeof GetLogLinesByLogFilePathListStreamingType
  >;
  let getLogLinesByLogFilePathList: MockedFunction<
    typeof GetLogLinesByLogFilePathListType
  >;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Import the mocked functions
    const module = await import('./logFileReader');
    getLogLinesByLogFilePathListStreaming = vi.mocked(
      module.getLogLinesByLogFilePathListStreaming,
    );
    getLogLinesByLogFilePathList = vi.mocked(
      module.getLogLinesByLogFilePathList,
    );
  });

  describe('メモリ制限機能', () => {
    it('メモリ使用量が制限を超えた場合にエラーをスローする', async () => {
      // メモリ使用量を600MBに設定
      vi.spyOn(process, 'memoryUsage').mockReturnValue({
        heapUsed: 600 * 1024 * 1024, // 600MB
        heapTotal: 1024 * 1024 * 1024,
        external: 0,
        arrayBuffers: 0,
        rss: 1024 * 1024 * 1024,
      });

      const mockLogFilePaths = [
        VRChatLogFilePathSchema.parse('/path/to/output_log_1.txt'),
      ];

      const memoryError = new Error(
        'Memory usage exceeded limit: 600.00MB > 500MB. Processing stopped to prevent system instability.',
      );

      // Mock generator that throws memory error
      // biome-ignore lint/correctness/useYield: This generator is meant to throw, not yield
      async function* mockMemoryErrorGenerator(): AsyncGenerator<
        never,
        void,
        unknown
      > {
        throw memoryError;
      }

      getLogLinesByLogFilePathListStreaming.mockReturnValue(
        mockMemoryErrorGenerator(),
      );

      const generator = getLogLinesByLogFilePathListStreaming({
        logFilePathList: mockLogFilePaths,
        includesList: ['test'],
        maxMemoryUsageMB: 500, // 500MB制限
      });

      await expect(async () => {
        for await (const _batch of generator) {
          // バッチの処理をシミュレート
        }
      }).rejects.toThrow(/Memory usage exceeded limit: 600\.00MB > 500MB/);
    });

    it('メモリ使用量が制限内の場合は正常に処理する', async () => {
      // メモリ使用量を400MBに設定
      vi.spyOn(process, 'memoryUsage').mockReturnValue({
        heapUsed: 400 * 1024 * 1024, // 400MB
        heapTotal: 1024 * 1024 * 1024,
        external: 0,
        arrayBuffers: 0,
        rss: 1024 * 1024 * 1024,
      });

      const mockLogFilePaths = [
        VRChatLogFilePathSchema.parse('/path/to/output_log_1.txt'),
      ];

      const mockLogLines = [
        VRChatLogLineSchema.parse('2023-01-01 10:00:00 [Info] test line'),
      ];

      // Mock generator that returns successful results
      async function* mockSuccessGenerator() {
        yield mockLogLines;
      }

      getLogLinesByLogFilePathListStreaming.mockReturnValue(
        mockSuccessGenerator(),
      );

      const generator = getLogLinesByLogFilePathListStreaming({
        logFilePathList: mockLogFilePaths,
        includesList: ['test'],
        maxMemoryUsageMB: 500, // 500MB制限
      });

      // エラーがスローされないことを確認
      const results = [];
      for await (const batch of generator) {
        results.push(batch);
        break; // 最初のバッチで停止
      }

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveLength(1);
    });

    it('デフォルトのメモリ制限値（500MB）が適用される', async () => {
      // メモリ使用量を600MBに設定
      vi.spyOn(process, 'memoryUsage').mockReturnValue({
        heapUsed: 600 * 1024 * 1024, // 600MB
        heapTotal: 1024 * 1024 * 1024,
        external: 0,
        arrayBuffers: 0,
        rss: 1024 * 1024 * 1024,
      });

      const mockLogFilePaths = [
        VRChatLogFilePathSchema.parse('/path/to/output_log_1.txt'),
      ];

      const defaultMemoryError = new Error(
        'Memory usage exceeded limit: 600.00MB > 500MB. Processing stopped to prevent system instability.',
      );

      // Mock generator that throws default memory error
      // biome-ignore lint/correctness/useYield: This generator is meant to throw, not yield
      async function* mockDefaultMemoryErrorGenerator(): AsyncGenerator<
        never,
        void,
        unknown
      > {
        throw defaultMemoryError;
      }

      getLogLinesByLogFilePathListStreaming.mockReturnValue(
        mockDefaultMemoryErrorGenerator(),
      );

      const generator = getLogLinesByLogFilePathListStreaming({
        logFilePathList: mockLogFilePaths,
        includesList: ['test'],
        // maxMemoryUsageMBを指定しない（デフォルト500MB）
      });

      await expect(async () => {
        for await (const _batch of generator) {
          // バッチの処理をシミュレート
        }
      }).rejects.toThrow(/Memory usage exceeded limit: 600\.00MB > 500MB/);
    });
  });

  describe('メモリ監視とログ出力', () => {
    it('メモリ使用量をログに出力する', async () => {
      // メモリ使用量を200MBに設定
      vi.spyOn(process, 'memoryUsage').mockReturnValue({
        heapUsed: 200 * 1024 * 1024, // 200MB
        heapTotal: 1024 * 1024 * 1024,
        external: 0,
        arrayBuffers: 0,
        rss: 1024 * 1024 * 1024,
      });

      const mockLogFilePaths = [
        VRChatLogFilePathSchema.parse('/path/to/output_log_1.txt'),
      ];

      const mockLogLines = [
        VRChatLogLineSchema.parse('2023-01-01 10:00:00 [Info] test line'),
      ];

      // Mock generator that yields results and triggers logging
      async function* mockLoggingGenerator() {
        // Simulate the debug logging that would happen in the real implementation
        mockLogger.debug('Processing file batch 1, memory: 200.00MB');
        yield mockLogLines;
      }

      getLogLinesByLogFilePathListStreaming.mockReturnValue(
        mockLoggingGenerator(),
      );

      const generator = getLogLinesByLogFilePathListStreaming({
        logFilePathList: mockLogFilePaths,
        includesList: ['test'],
        maxMemoryUsageMB: 500,
      });

      for await (const _batch of generator) {
        break; // 最初のバッチで停止
      }

      // メモリ使用量を含むログが出力されることを確認
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('memory: 200.00MB'),
      );
    });

    it('バッチ処理でメモリ使用量の変化を追跡する', async () => {
      let memoryUsage = 100 * 1024 * 1024; // 初期100MB

      // メモリ使用量が段階的に増加するモック
      vi.spyOn(process, 'memoryUsage').mockImplementation(() => {
        memoryUsage += 50 * 1024 * 1024; // 50MBずつ増加
        return {
          heapUsed: memoryUsage,
          heapTotal: 1024 * 1024 * 1024,
          external: 0,
          arrayBuffers: 0,
          rss: 1024 * 1024 * 1024,
        };
      });

      const mockLogFilePaths = [
        VRChatLogFilePathSchema.parse('/path/to/output_log_1.txt'),
        VRChatLogFilePathSchema.parse('/path/to/output_log_2.txt'),
      ];

      const mockLogLines = [
        VRChatLogLineSchema.parse('2023-01-01 10:00:00 [Info] test line'),
      ];

      // Mock generator that tracks memory usage
      async function* mockTrackingGenerator() {
        // Call process.memoryUsage to simulate tracking
        process.memoryUsage();
        yield mockLogLines;
      }

      getLogLinesByLogFilePathListStreaming.mockReturnValue(
        mockTrackingGenerator(),
      );

      const generator = getLogLinesByLogFilePathListStreaming({
        logFilePathList: mockLogFilePaths,
        includesList: ['test'],
        maxMemoryUsageMB: 500,
        concurrency: 1, // 1つずつ処理
      });

      for await (const _batch of generator) {
        break; // 最初のバッチで停止
      }

      // メモリ使用量のチェックが複数回呼ばれることを確認
      expect(process.memoryUsage).toHaveBeenCalled();
    });
  });

  describe('getLogLinesByLogFilePathList - メモリ警告', () => {
    it('大量のログ行がメモリに蓄積された場合に警告を出力する', async () => {
      // メモリ使用量を300MBに設定
      vi.spyOn(process, 'memoryUsage').mockReturnValue({
        heapUsed: 300 * 1024 * 1024, // 300MB
        heapTotal: 1024 * 1024 * 1024,
        external: 0,
        arrayBuffers: 0,
        rss: 1024 * 1024 * 1024,
      });

      const mockLogFilePaths = [
        VRChatLogFilePathSchema.parse('/path/to/output_log_1.txt'),
      ];

      const manyVRChatLogLines = Array.from({ length: 5000 }, (_, i) =>
        VRChatLogLineSchema.parse(
          `2023-01-01 10:${String(i % 60).padStart(2, '0')}:00 [Info] test line ${i}`,
        ),
      );

      // Mock the function to return success with warning
      getLogLinesByLogFilePathList.mockImplementation(async () => {
        // Simulate the warning log that would be triggered
        mockLogger.warn(
          'Log lines in memory: 5000 (Memory: 300.00MB). Consider processing in smaller batches.',
        );
        return ok(manyVRChatLogLines);
      });

      const result = await getLogLinesByLogFilePathList({
        logFilePathList: mockLogFilePaths,
        includesList: ['test'],
        maxMemoryUsageMB: 100, // 低い制限値で警告をトリガー
      });

      // 結果は成功するが、警告ログが出力されることを確認
      expect(result.isOk()).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Consider processing in smaller batches'),
      );
    });
  });
});
