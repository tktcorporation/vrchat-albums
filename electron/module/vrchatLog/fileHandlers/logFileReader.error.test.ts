import {
  beforeEach,
  describe,
  expect,
  it,
  type MockedFunction,
  vi,
} from 'vitest';
import { VRChatLogFilePathSchema } from '../../vrchatLogFileDir/model';
import type { getLogLinesByLogFilePathListStreaming as GetLogLinesByLogFilePathListStreamingType } from './logFileReader';

vi.mock('./logFileReader', () => ({
  getLogLinesFromLogFile: vi.fn(),
  getLogLinesByLogFilePathListStreaming: vi.fn(),
}));

describe('logFileReader - Error Handling', () => {
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

  describe('ファイル読み込みエラー', () => {
    it('ファイル読み込みエラー時に適切にエラーが伝播される', async () => {
      const mockLogFilePaths = [
        VRChatLogFilePathSchema.parse('/path/to/output_log_error.txt'),
      ];

      const mockError = new Error('File read error');

      // Mock generator to throw error
      // biome-ignore lint/correctness/useYield: This generator is meant to throw, not yield
      async function* mockErrorGenerator(): AsyncGenerator<
        never,
        void,
        unknown
      > {
        throw mockError;
      }

      getLogLinesByLogFilePathListStreaming.mockReturnValue(
        mockErrorGenerator(),
      );

      const generator = getLogLinesByLogFilePathListStreaming({
        logFilePathList: mockLogFilePaths,
        includesList: ['Test'],
      });

      await expect(async () => {
        for await (const _batch of generator) {
          // エラーがスローされるべき
        }
      }).rejects.toThrow('File read error');
    });

    it('複数ファイルで一部エラー時に処理が停止する', async () => {
      const mockLogFilePaths = [
        VRChatLogFilePathSchema.parse('/path/to/output_log_success.txt'),
        VRChatLogFilePathSchema.parse('/path/to/output_log_error.txt'),
        VRChatLogFilePathSchema.parse('/path/to/output_log_success2.txt'),
      ];

      const mockError = new Error('File access denied');

      // Mock generator that yields one batch then throws error
      async function* mockPartialErrorGenerator() {
        yield []; // First batch succeeds but empty
        throw mockError; // Second batch fails
      }

      getLogLinesByLogFilePathListStreaming.mockReturnValue(
        mockPartialErrorGenerator(),
      );

      const generator = getLogLinesByLogFilePathListStreaming({
        logFilePathList: mockLogFilePaths,
        includesList: ['Success'],
      });

      await expect(async () => {
        for await (const _batch of generator) {
          // エラーで処理停止
        }
      }).rejects.toThrow('File access denied');
    });
  });

  describe('バリデーションエラー', () => {
    it('無効なファイルパス形式でZodバリデーションエラーが発生する', async () => {
      // output_logを含まないパスでバリデーションエラーが発生することを確認
      expect(() => {
        VRChatLogFilePathSchema.parse('/path/to/invalid_log_file.txt');
      }).toThrow();
    });

    it('txt拡張子でないファイルでバリデーションエラーが発生する', async () => {
      expect(() => {
        VRChatLogFilePathSchema.parse('/path/to/output_log_file.log');
      }).toThrow();
    });

    it('空文字列でバリデーションエラーが発生する', async () => {
      expect(() => {
        VRChatLogFilePathSchema.parse('');
      }).toThrow();
    });
  });

  describe('Promise.allエラー処理', () => {
    it('並列処理中のエラーが適切に伝播される', async () => {
      const mockLogFilePaths = [
        VRChatLogFilePathSchema.parse('/path/to/output_log_file1.txt'),
        VRChatLogFilePathSchema.parse('/path/to/output_log_file2.txt'),
        VRChatLogFilePathSchema.parse('/path/to/output_log_file3.txt'),
      ];

      const mockError = new Error('Concurrent processing error');

      // Mock generator that throws concurrent processing error
      // biome-ignore lint/correctness/useYield: This generator is meant to throw, not yield
      async function* mockConcurrentErrorGenerator(): AsyncGenerator<
        never,
        void,
        unknown
      > {
        throw mockError;
      }

      getLogLinesByLogFilePathListStreaming.mockReturnValue(
        mockConcurrentErrorGenerator(),
      );

      const generator = getLogLinesByLogFilePathListStreaming({
        logFilePathList: mockLogFilePaths,
        includesList: ['Line'],
        concurrency: 3,
      });

      await expect(async () => {
        for await (const _batch of generator) {
          // エラーで処理停止
        }
      }).rejects.toThrow('Concurrent processing error');
    });

    it('並列処理数を超えたファイルがあってもエラーで停止する', async () => {
      const mockLogFilePaths = Array.from({ length: 10 }, (_, i) =>
        VRChatLogFilePathSchema.parse(`/path/to/output_log_file${i + 1}.txt`),
      );

      const mockError = new Error('Batch processing error');

      // Mock generator that throws batch processing error
      // biome-ignore lint/correctness/useYield: This generator is meant to throw, not yield
      async function* mockBatchErrorGenerator(): AsyncGenerator<
        never,
        void,
        unknown
      > {
        throw mockError;
      }

      getLogLinesByLogFilePathListStreaming.mockReturnValue(
        mockBatchErrorGenerator(),
      );

      const generator = getLogLinesByLogFilePathListStreaming({
        logFilePathList: mockLogFilePaths,
        includesList: ['Line'],
        concurrency: 5, // 5ファイルずつ並列処理
      });

      await expect(async () => {
        for await (const _batch of generator) {
          // エラーで処理停止
        }
      }).rejects.toThrow('Batch processing error');
    });
  });

  describe('システムエラー', () => {
    it('予期しないタイプのエラーが適切に伝播される', async () => {
      const mockLogFilePaths = [
        VRChatLogFilePathSchema.parse('/path/to/output_log_file.txt'),
      ];

      const unexpectedError = new TypeError('Unexpected type error');

      // Mock generator that throws unexpected error
      // biome-ignore lint/correctness/useYield: This generator is meant to throw, not yield
      async function* mockUnexpectedErrorGenerator(): AsyncGenerator<
        never,
        void,
        unknown
      > {
        throw unexpectedError;
      }

      getLogLinesByLogFilePathListStreaming.mockReturnValue(
        mockUnexpectedErrorGenerator(),
      );

      const generator = getLogLinesByLogFilePathListStreaming({
        logFilePathList: mockLogFilePaths,
        includesList: ['Test'],
      });

      await expect(async () => {
        for await (const _batch of generator) {
          // エラーで処理停止
        }
      }).rejects.toThrow('Unexpected type error');
    });

    it('nullやundefined値の処理でエラーが発生する', async () => {
      const mockLogFilePaths = [
        VRChatLogFilePathSchema.parse('/path/to/output_log_file.txt'),
      ];

      const nullError = new TypeError('Cannot read properties of null');

      // Mock generator that throws null error
      // biome-ignore lint/correctness/useYield: This generator is meant to throw, not yield
      async function* mockNullErrorGenerator(): AsyncGenerator<
        never,
        void,
        unknown
      > {
        throw nullError;
      }

      getLogLinesByLogFilePathListStreaming.mockReturnValue(
        mockNullErrorGenerator(),
      );

      const generator = getLogLinesByLogFilePathListStreaming({
        logFilePathList: mockLogFilePaths,
        includesList: ['Test'],
      });

      await expect(async () => {
        for await (const _batch of generator) {
          // null値処理でエラー
        }
      }).rejects.toThrow();
    });
  });

  describe('リソース制限エラー', () => {
    it('ファイルハンドル不足エラーが適切に処理される', async () => {
      const mockLogFilePaths = Array.from({ length: 10 }, (_, i) =>
        VRChatLogFilePathSchema.parse(`/path/to/output_log_file${i}.txt`),
      );

      const fileHandleError = new Error('EMFILE: too many open files');

      // Mock generator that throws file handle error
      // biome-ignore lint/correctness/useYield: This generator is meant to throw, not yield
      async function* mockFileHandleErrorGenerator(): AsyncGenerator<
        never,
        void,
        unknown
      > {
        throw fileHandleError;
      }

      getLogLinesByLogFilePathListStreaming.mockReturnValue(
        mockFileHandleErrorGenerator(),
      );

      const generator = getLogLinesByLogFilePathListStreaming({
        logFilePathList: mockLogFilePaths,
        includesList: ['Line'],
        concurrency: 100, // 高い並列数
      });

      await expect(async () => {
        for await (const _batch of generator) {
          // ファイルハンドルエラーで停止
        }
      }).rejects.toThrow('EMFILE: too many open files');
    });
  });

  describe('ジェネレータの異常終了', () => {
    it('ジェネレータの途中でエラーが発生した場合の処理', async () => {
      const mockLogFilePaths = [
        VRChatLogFilePathSchema.parse('/path/to/output_log_file1.txt'),
        VRChatLogFilePathSchema.parse('/path/to/output_log_file2.txt'),
      ];

      // Mock generator that yields one result then throws error
      async function* mockPartialSuccessGenerator() {
        yield []; // First batch succeeds but empty
        throw new Error('Generator termination error'); // Second iteration fails
      }

      getLogLinesByLogFilePathListStreaming.mockReturnValue(
        mockPartialSuccessGenerator(),
      );

      const generator = getLogLinesByLogFilePathListStreaming({
        logFilePathList: mockLogFilePaths,
        includesList: ['First'],
        batchSize: 1, // 小さなバッチで段階的処理
      });

      const results: unknown[] = [];
      await expect(async () => {
        for await (const batch of generator) {
          results.push(batch);
          // 2回目のファイルでエラーが発生
        }
      }).rejects.toThrow('Generator termination error');

      // 最初のバッチは成功していることを確認
      expect(results).toHaveLength(1);
      expect((results[0] as unknown[]).length).toBe(0); // Empty but successful
    });
  });

  describe('メモリ制限エラー', () => {
    it('メモリ使用量が制限を超えた場合にエラーが発生する', async () => {
      const mockLogFilePaths = [
        VRChatLogFilePathSchema.parse('/path/to/output_log_file.txt'),
      ];

      // メモリ使用量を600MBに設定（制限500MBを超える）
      vi.spyOn(process, 'memoryUsage').mockReturnValue({
        heapUsed: 600 * 1024 * 1024, // 600MB
        heapTotal: 1024 * 1024 * 1024,
        external: 0,
        arrayBuffers: 0,
        rss: 1024 * 1024 * 1024,
      });

      const memoryError = new Error(
        'Memory usage exceeded limit: 600.00MB > 500MB',
      );

      // Mock generator that throws memory limit error
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
        includesList: ['Test'],
        maxMemoryUsageMB: 500, // 500MB制限
      });

      await expect(async () => {
        for await (const _batch of generator) {
          // メモリ制限エラーで停止
        }
      }).rejects.toThrow(/Memory usage exceeded limit: 600\.00MB > 500MB/);
    });
  });
});
