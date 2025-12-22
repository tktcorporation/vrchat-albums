import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as datefns from 'date-fns';
import { app } from 'electron';
import { match, P } from 'ts-pattern';
import {
  exportLogsToLogStore,
  formatLogStoreContent,
  type LogRecord,
} from '../converters/dbToLogStore';

/**
 * DBからlogStore形式でエクスポートするサービス
 */

export interface ExportLogStoreOptions {
  startDate?: Date;
  endDate?: Date;
  outputBasePath?: string;
}

export interface ExportResult {
  exportedFiles: string[];
  totalLogLines: number;
  exportStartTime: Date;
  exportEndTime: Date;
}

export type DBLogProvider = (
  startDate?: Date,
  endDate?: Date,
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
 * エクスポート実行日時からフォルダ名を生成
 * @param exportDateTime エクスポート実行日時
 * @returns フォルダ名（例: vrchat-albums-export_2023-11-15_10-20-30）
 */
const generateExportFolderName = (exportDateTime: Date): string => {
  const formattedDateTime = datefns.format(
    exportDateTime,
    'yyyy-MM-dd_HH-mm-ss',
  );
  return `vrchat-albums-export_${formattedDateTime}`;
};

/**
 * 日付からlogStore形式のファイルパスを生成
 * @param date 対象日付
 * @param basePath ベースパス（省略時はデフォルト）
 * @param exportDateTime エクスポート実行日時（省略時は現在時刻）
 * @returns logStore形式のファイルパス
 */
export const getLogStoreExportPath = (
  date: Date,
  basePath?: string,
  exportDateTime?: Date,
): string => {
  const base = basePath || getDefaultLogStorePath();
  const yearMonth = datefns.format(date, 'yyyy-MM');
  const fileName = `logStore-${yearMonth}.txt`;

  // エクスポート実行日時のサブフォルダ名を生成
  const exportTime = exportDateTime || new Date();
  const exportFolder = generateExportFolderName(exportTime);

  return path.join(base, exportFolder, yearMonth, fileName);
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
      // TODO: アプリイベントの処理は今後実装
      // .with(
      //   { type: 'appEvent' },
      //   (record) => (record.record as { eventDateTime: Date }).eventDateTime,
      // )
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
    // DBからログデータを取得（期間指定がない場合は全データ取得）
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
          exportStartTime,
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
    const errorMessage = match(error)
      .with(P.instanceOf(Error), (err) => err.message)
      .otherwise(() => String(error));

    throw new Error(`Export failed: ${errorMessage}`);
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
    // DBからログデータを取得（期間指定がない場合は全データ取得）
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

    // エクスポート実行日時のサブフォルダ名を生成
    const exportFolder = generateExportFolderName(exportStartTime);
    const outputDir = path.dirname(outputFilePath);
    const outputFileName = path.basename(outputFilePath);
    const finalOutputPath = path.join(outputDir, exportFolder, outputFileName);

    // ディレクトリを作成
    const dirPath = path.dirname(finalOutputPath);
    await ensureDirectoryExists(dirPath);

    // ファイルに書き込み
    const content = formatLogStoreContent(logLines);
    await fs.writeFile(finalOutputPath, content, 'utf-8');

    const exportEndTime = new Date();

    return {
      exportedFiles: [finalOutputPath],
      totalLogLines: logLines.length,
      exportStartTime,
      exportEndTime,
    };
  } catch (error) {
    const errorMessage = match(error)
      .with(P.instanceOf(Error), (err) => err.message)
      .otherwise(() => String(error));

    throw new Error(`Export failed: ${errorMessage}`);
  }
};
