import * as nodeFs from 'node:fs';
import readline from 'node:readline';
import * as neverthrow from 'neverthrow';
import { match } from 'ts-pattern';
import { logger } from '../../../lib/logger';
import * as fs from '../../../lib/wrappedFs';
import type { VRChatLogFilePath } from '../../vrchatLogFileDir/model';
import type { VRChatLogFileError } from '../error';
import type { VRChatLogLine, VRChatLogStoreFilePath } from '../model';
import { VRChatLogLineSchema } from '../model';
import type { PartialSuccessResult } from '../types/partialSuccess';
import { createPartialSuccessResult } from '../types/partialSuccess';

/**
 * VRChatログファイルの読み込み機能
 */

/**
 * 共通のバッチ処理設定
 */
interface BatchConfig {
  concurrency: number;
  maxMemoryUsageMB: number;
  maxLinesInMemory: number;
}

/**
 * メモリ監視機能
 */
interface MemoryMonitor {
  checkMemoryUsage: () => number;
  checkMemoryLimit: (maxMemoryUsageMB: number) => number;
}

/**
 * バッチ処理設定を作成
 */
const createBatchConfig = (props: {
  concurrency?: number;
  maxMemoryUsageMB?: number;
}): BatchConfig => {
  const concurrency = props.concurrency ?? 5;
  const maxMemoryUsageMB = props.maxMemoryUsageMB ?? 500;
  const maxLinesInMemory = Math.floor((maxMemoryUsageMB * 1024 * 1024) / 200); // 1行約200バイトと仮定

  return { concurrency, maxMemoryUsageMB, maxLinesInMemory };
};

/**
 * メモリ監視ユーティリティを作成
 */
const createMemoryMonitor = (): MemoryMonitor => {
  const checkMemoryUsage = () => {
    const memUsage = process.memoryUsage();
    return memUsage.heapUsed / 1024 / 1024;
  };

  const checkMemoryLimit = (maxMemoryUsageMB: number) => {
    const currentUsage = checkMemoryUsage();
    return match(currentUsage > maxMemoryUsageMB)
      .with(true, () => {
        throw new Error(
          `Memory usage exceeded limit: ${currentUsage.toFixed(
            2,
          )}MB > ${maxMemoryUsageMB}MB. Processing stopped to prevent system instability.`,
        );
      })
      .with(false, () => currentUsage)
      .exhaustive();
  };

  return { checkMemoryUsage, checkMemoryLimit };
};

/**
 * ログファイルから指定された文字列を含む行を抽出
 * @param props.logFilePath ログファイルのパス
 * @param props.includesList 抽出対象とする文字列のリスト
 * @returns 抽出されたログ行の配列
 */
export const getLogLinesFromLogFile = async (props: {
  logFilePath: VRChatLogFilePath | VRChatLogStoreFilePath;
  includesList: string[];
}): Promise<neverthrow.Result<string[], VRChatLogFileError>> => {
  // ファイルが存在するか確認
  return match(nodeFs.existsSync(props.logFilePath.value))
    .with(false, () => neverthrow.ok<string[], VRChatLogFileError>([]))
    .with(true, async () => {
      const stream = fs.createReadStream(props.logFilePath.value);
      const reader = readline.createInterface({
        input: stream,
        crlfDelay: Number.POSITIVE_INFINITY,
      });

      const lines: string[] = [];
      reader.on('line', (line) => {
        // includesList の配列の中のどれかと一致したら追加
        if (props.includesList.some((include) => line.includes(include))) {
          lines.push(line);
        }
      });

      await Promise.all([
        new Promise((resolve) => {
          stream.on('close', () => {
            resolve(null);
          });
        }),
      ]);

      return neverthrow.ok(lines);
    })
    .exhaustive();
};

/**
 * 複数のログファイルから指定された文字列を含む行を抽出
 * @param props.logFilePathList ログファイルパスのリスト
 * @param props.includesList 抽出対象とする文字列のリスト
 * @param props.concurrency 並列処理数（デフォルト: 5）
 * @returns 抽出されたVRChatLogLineの配列
 */
export const getLogLinesByLogFilePathList = async (props: {
  logFilePathList: (VRChatLogFilePath | VRChatLogStoreFilePath)[];
  includesList: string[];
  concurrency?: number;
  maxMemoryUsageMB?: number; // メモリ使用量の上限（MB）
}): Promise<neverthrow.Result<VRChatLogLine[], VRChatLogFileError>> => {
  const config = createBatchConfig(props);
  const memoryMonitor = createMemoryMonitor();
  const logLineList: VRChatLogLine[] = [];
  const errors: VRChatLogFileError[] = [];

  // バッチ処理で並列数を制限
  for (let i = 0; i < props.logFilePathList.length; i += config.concurrency) {
    const batch = props.logFilePathList.slice(i, i + config.concurrency);
    const batchResults = await Promise.all(
      batch.map(async (logFilePath) => {
        const result = await getLogLinesFromLogFile({
          logFilePath,
          includesList: props.includesList,
        });
        if (result.isErr()) {
          errors.push(result.error);
          return [];
        }
        // 各行をパースし、失敗した行はスキップ
        const validLines: VRChatLogLine[] = [];
        for (const line of result.value) {
          const parseResult = VRChatLogLineSchema.safeParse(line);
          if (parseResult.success) {
            validLines.push(parseResult.data);
          } else {
            logger.warn(
              `Failed to parse log line in ${logFilePath.value}: ${parseResult.error.message}`,
            );
          }
        }
        return validLines;
      }),
    );

    // バッチの結果を統合
    for (const lines of batchResults) {
      logLineList.push(...lines);

      // メモリ使用量をチェックし、上限に近づいたら警告
      if (logLineList.length > config.maxLinesInMemory) {
        const usedMB = memoryMonitor.checkMemoryUsage();
        logger.warn(
          `Log lines in memory: ${logLineList.length} (Memory: ${usedMB.toFixed(
            2,
          )}MB). Consider processing in smaller batches.`,
        );
      }
    }
  }

  logger.info(
    `Loaded ${logLineList.length} log lines from ${
      props.logFilePathList.length
    } files (Memory: ${memoryMonitor.checkMemoryUsage().toFixed(2)}MB)`,
  );

  return match(errors.length > 0)
    .with(true, () =>
      neverthrow.err<VRChatLogLine[], VRChatLogFileError>(errors[0]),
    )
    .with(false, () => neverthrow.ok(logLineList))
    .exhaustive();
};

/**
 * 複数のログファイルから指定された文字列を含む行を抽出（部分的な成功を許容）
 * エラーが発生しても処理を継続し、成功した部分のデータを返す
 * @param props.logFilePathList ログファイルパスのリスト
 * @param props.includesList 抽出対象とする文字列のリスト
 * @param props.concurrency 並列処理数（デフォルト: 5）
 * @param props.maxMemoryUsageMB メモリ使用量の上限（MB）
 * @returns 部分的な成功結果（成功したデータとエラー情報）
 */
export const getLogLinesByLogFilePathListWithPartialSuccess = async (props: {
  logFilePathList: (VRChatLogFilePath | VRChatLogStoreFilePath)[];
  includesList: string[];
  concurrency?: number;
  maxMemoryUsageMB?: number;
}): Promise<
  PartialSuccessResult<
    VRChatLogLine[],
    { path: string; error: VRChatLogFileError }
  >
> => {
  const config = createBatchConfig(props);
  const memoryMonitor = createMemoryMonitor();
  const logLineList: VRChatLogLine[] = [];
  const errors: { path: string; error: VRChatLogFileError }[] = [];

  // バッチ処理で並列数を制限
  for (let i = 0; i < props.logFilePathList.length; i += config.concurrency) {
    const batch = props.logFilePathList.slice(i, i + config.concurrency);
    const batchResults = await Promise.all(
      batch.map(async (logFilePath) => {
        const result = await getLogLinesFromLogFile({
          logFilePath,
          includesList: props.includesList,
        });
        if (result.isErr()) {
          errors.push({ path: logFilePath.value, error: result.error });
          return [];
        }

        // 各行をパースし、失敗した行はスキップ
        const validLines: VRChatLogLine[] = [];
        for (const line of result.value) {
          const parseResult = VRChatLogLineSchema.safeParse(line);
          if (parseResult.success) {
            validLines.push(parseResult.data);
          } else {
            // パースエラーは警告として記録し、処理を継続
            logger.warn(
              `Failed to parse log line in ${logFilePath.value}: ${parseResult.error.message}`,
            );
          }
        }
        return validLines;
      }),
    );

    // バッチの結果を統合
    for (const lines of batchResults) {
      logLineList.push(...lines);

      // メモリ使用量をチェックし、上限に近づいたら警告
      if (logLineList.length > config.maxLinesInMemory) {
        const usedMB = memoryMonitor.checkMemoryUsage();
        logger.warn(
          `Log lines in memory: ${logLineList.length} (Memory: ${usedMB.toFixed(
            2,
          )}MB). Consider processing in smaller batches.`,
        );
      }
    }
  }

  const totalFiles = props.logFilePathList.length;
  const successCount = totalFiles - errors.length;

  logger.info(
    `Loaded ${logLineList.length} log lines from ${successCount}/${totalFiles} files ` +
      `(${errors.length} errors, Memory: ${memoryMonitor
        .checkMemoryUsage()
        .toFixed(2)}MB)`,
  );

  return match(errors.length > 0)
    .with(true, () => {
      logger.warn(
        `Failed to process ${errors.length} log files:`,
        errors.map((e) => ({ path: e.path, code: e.error.code })),
      );
      return createPartialSuccessResult(logLineList, errors, totalFiles);
    })
    .with(false, () =>
      createPartialSuccessResult(logLineList, errors, totalFiles),
    )
    .exhaustive();
};

/**
 * 複数のログファイルから指定された文字列を含む行をストリーミングで抽出
 * メモリ効率を考慮し、ジェネレータでバッチごとに結果を返す
 * @param props.logFilePathList ログファイルパスのリスト
 * @param props.includesList 抽出対象とする文字列のリスト
 * @param props.concurrency 並列処理数（デフォルト: 5）
 * @param props.batchSize バッチサイズ（デフォルト: 1000行）
 * @param props.maxMemoryUsageMB メモリ使用量の上限（MB、デフォルト: 500）
 */
export async function* getLogLinesByLogFilePathListStreaming(props: {
  logFilePathList: (VRChatLogFilePath | VRChatLogStoreFilePath)[];
  includesList: string[];
  concurrency?: number;
  batchSize?: number;
  maxMemoryUsageMB?: number;
}): AsyncGenerator<VRChatLogLine[], void, unknown> {
  const config = createBatchConfig(props);
  const memoryMonitor = createMemoryMonitor();
  const batchSize = props.batchSize ?? 1000;
  let accumulatedLines: VRChatLogLine[] = [];
  let totalLinesProcessed = 0;

  // ファイルバッチごとに処理
  for (let i = 0; i < props.logFilePathList.length; i += config.concurrency) {
    // メモリ使用量をチェック
    const currentMemory = memoryMonitor.checkMemoryLimit(
      config.maxMemoryUsageMB,
    );
    logger.debug(
      `Processing file batch ${
        Math.floor(i / config.concurrency) + 1
      }, memory: ${currentMemory.toFixed(2)}MB`,
    );

    const fileBatch = props.logFilePathList.slice(i, i + config.concurrency);
    const batchResults = await Promise.all(
      fileBatch.map(async (logFilePath) => {
        const result = await getLogLinesFromLogFile({
          logFilePath,
          includesList: props.includesList,
        });
        if (result.isErr()) {
          throw result.error;
        }
        // 各行をパースし、失敗した行はスキップ
        const validLines: VRChatLogLine[] = [];
        for (const line of result.value) {
          const parseResult = VRChatLogLineSchema.safeParse(line);
          if (parseResult.success) {
            validLines.push(parseResult.data);
          } else {
            logger.warn(
              `Failed to parse log line in ${logFilePath.value}: ${parseResult.error.message}`,
            );
          }
        }
        return validLines;
      }),
    );

    // 各ファイルの結果を処理
    for (const lines of batchResults) {
      accumulatedLines.push(...lines);

      // バッチサイズに達したかメモリ使用量をチェック
      while (accumulatedLines.length >= batchSize) {
        const batch = accumulatedLines.slice(0, batchSize);
        accumulatedLines = accumulatedLines.slice(batchSize);
        totalLinesProcessed += batch.length;

        const memoryUsage = memoryMonitor.checkMemoryUsage();
        logger.debug(
          `Streaming log lines: yielding batch of ${
            batch.length
          } lines (total: ${totalLinesProcessed}, memory: ${memoryUsage.toFixed(
            2,
          )}MB)`,
        );

        // バッチを返す前にメモリチェック
        memoryMonitor.checkMemoryLimit(config.maxMemoryUsageMB);
        yield batch;
      }
    }
  }

  // 残りのログ行をyield
  if (accumulatedLines.length > 0) {
    totalLinesProcessed += accumulatedLines.length;
    const memoryUsage = memoryMonitor.checkMemoryUsage();
    logger.debug(
      `Streaming log lines: yielding final batch of ${
        accumulatedLines.length
      } lines (total: ${totalLinesProcessed}, memory: ${memoryUsage.toFixed(
        2,
      )}MB)`,
    );

    // 最終バッチを返す前にメモリチェック
    memoryMonitor.checkMemoryLimit(config.maxMemoryUsageMB);
    yield accumulatedLines;
  }
}
