import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as datefns from 'date-fns';
import { app } from 'electron';
import { match } from 'ts-pattern';
import {
  type LogRecord,
  exportLogsToLogStore,
  formatLogStoreContent,
} from '../converters/dbToLogStore';

/**
 * DBからlogStore形式でエクスポートするサービス
 */

export interface ExportLogStoreOptions {
  startDate: Date;
  endDate: Date;
  outputBasePath?: string;
}

export interface ExportResult {
  exportedFiles: string[];
  totalLogLines: number;
  exportStartTime: Date;
  exportEndTime: Date;
}

export type DBLogProvider = (
  startDate: Date,
  endDate: Date,
) => Promise<LogRecord[]>;

/**
 * デフォルトのlogStoreディレクトリパスを取得
 */
const getDefaultLogStorePath = (): string => {
  try {
    // ダウンロードフォルダ内にlogStoreフォルダを作成
    const downloadsPath = app.getPath('downloads');
    return path.join(downloadsPath, 'logStore');
  } catch (_error) {
    // テスト環境などでappが利用できない場合のフォールバック
    return path.join(process.cwd(), 'logStore');
  }
};

/**
 * 日付からlogStore形式のファイルパスを生成
 * @param date 対象日付
 * @param basePath ベースパス（省略時はデフォルト）
 * @returns logStore形式のファイルパス
 */
export const getLogStoreExportPath = (
  date: Date,
  basePath?: string,
): string => {
  const base = basePath || getDefaultLogStorePath();
  const yearMonth = datefns.format(date, 'yyyy-MM');
  const fileName = `logStore-${yearMonth}.txt`;

  return path.join(base, yearMonth, fileName);
};

/**
 * ログレコードを月別にグループ化
 * @param logRecords ログレコード配列
 * @returns 月別にグループ化されたログレコード
 */
const groupLogRecordsByMonth = (
  logRecords: LogRecord[],
): Map<string, LogRecord[]> => {
  const groupedRecords = new Map<string, LogRecord[]>();

  for (const logRecord of logRecords) {
    const recordDate = match(logRecord)
      .with(
        { type: 'worldJoin' },
        (record) => (record.record as { joinDateTime: Date }).joinDateTime,
      )
      .with(
        { type: 'playerJoin' },
        (record) => (record.record as { joinDateTime: Date }).joinDateTime,
      )
      .with(
        { type: 'playerLeave' },
        (record) => (record.record as { leaveDateTime: Date }).leaveDateTime,
      )
      .exhaustive();

    const yearMonth = datefns.format(recordDate, 'yyyy-MM');

    if (!groupedRecords.has(yearMonth)) {
      groupedRecords.set(yearMonth, []);
    }

    groupedRecords.get(yearMonth)?.push(logRecord);
  }

  return groupedRecords;
};

/**
 * ディレクトリを作成（再帰的）
 * @param dirPath 作成するディレクトリパス
 */
const ensureDirectoryExists = async (dirPath: string): Promise<void> => {
  await fs.mkdir(dirPath, { recursive: true });
};

/**
 * DBからlogStore形式でデータをエクスポート
 * @param options エクスポートオプション
 * @param getDBLogs DB取得関数
 * @returns エクスポート結果
 */
export const exportLogStoreFromDB = async (
  options: ExportLogStoreOptions,
  getDBLogs: DBLogProvider,
): Promise<ExportResult> => {
  const exportStartTime = new Date();

  try {
    // DBからログデータを取得
    const logRecords = await getDBLogs(options.startDate, options.endDate);

    if (logRecords.length === 0) {
      return {
        exportedFiles: [],
        totalLogLines: 0,
        exportStartTime,
        exportEndTime: new Date(),
      };
    }

    // 月別にグループ化
    const groupedRecords = groupLogRecordsByMonth(logRecords);

    const exportedFiles: string[] = [];
    let totalLogLines = 0;

    // 月別にファイルを作成
    for (const [yearMonth, monthRecords] of groupedRecords) {
      // logStore形式に変換
      const logLines = exportLogsToLogStore(monthRecords);
      totalLogLines += logLines.length;

      if (logLines.length > 0) {
        // ファイルパスを生成
        const sampleDate = datefns.parse(yearMonth, 'yyyy-MM', new Date());
        const filePath = getLogStoreExportPath(
          sampleDate,
          options.outputBasePath,
        );

        // ディレクトリを作成
        const dirPath = path.dirname(filePath);
        await ensureDirectoryExists(dirPath);

        // ファイルに書き込み
        const content = formatLogStoreContent(logLines);
        await fs.writeFile(filePath, content, 'utf-8');

        exportedFiles.push(filePath);
      }
    }

    const exportEndTime = new Date();

    return {
      exportedFiles,
      totalLogLines,
      exportStartTime,
      exportEndTime,
    };
  } catch (error) {
    throw new Error(
      `Export failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
};

/**
 * 単一ファイルとしてlogStoreデータをエクスポート
 * @param options エクスポートオプション
 * @param getDBLogs DB取得関数
 * @param outputFilePath 出力ファイルパス
 * @returns エクスポート結果
 */
export const exportLogStoreToSingleFile = async (
  options: ExportLogStoreOptions,
  getDBLogs: DBLogProvider,
  outputFilePath: string,
): Promise<ExportResult> => {
  const exportStartTime = new Date();

  try {
    // DBからログデータを取得
    const logRecords = await getDBLogs(options.startDate, options.endDate);

    if (logRecords.length === 0) {
      return {
        exportedFiles: [],
        totalLogLines: 0,
        exportStartTime,
        exportEndTime: new Date(),
      };
    }

    // logStore形式に変換
    const logLines = exportLogsToLogStore(logRecords);

    // ディレクトリを作成
    const dirPath = path.dirname(outputFilePath);
    await ensureDirectoryExists(dirPath);

    // ファイルに書き込み
    const content = formatLogStoreContent(logLines);
    await fs.writeFile(outputFilePath, content, 'utf-8');

    const exportEndTime = new Date();

    return {
      exportedFiles: [outputFilePath],
      totalLogLines: logLines.length,
      exportStartTime,
      exportEndTime,
    };
  } catch (error) {
    throw new Error(
      `Export failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
};
