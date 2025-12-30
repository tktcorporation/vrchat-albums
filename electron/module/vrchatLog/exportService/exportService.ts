import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as datefns from 'date-fns';
import { app } from 'electron';
import * as neverthrow from 'neverthrow';
import { ResultAsync } from 'neverthrow';
import { match } from 'ts-pattern';
import {
  exportLogsToLogStore,
  formatLogStoreContent,
  type LogRecord,
} from '../converters/dbToLogStore';

/**
 * DBからlogStore形式でエクスポートするサービス
 */

/**
 * エクスポートエラー型
 */
export type ExportError =
  | { type: 'DIR_CREATE_FAILED'; path: string; message: string }
  | { type: 'FILE_WRITE_FAILED'; path: string; message: string }
  | { type: 'DB_QUERY_FAILED'; message: string };

/**
 * ExportErrorからユーザー向けメッセージを取得
 */
export const getExportErrorMessage = (error: ExportError): string =>
  match(error)
    .with(
      { type: 'DIR_CREATE_FAILED' },
      (e) => `ディレクトリ作成に失敗しました: ${e.path} (${e.message})`,
    )
    .with(
      { type: 'FILE_WRITE_FAILED' },
      (e) => `ファイル書き込みに失敗しました: ${e.path} (${e.message})`,
    )
    .with(
      { type: 'DB_QUERY_FAILED' },
      (e) => `データベースクエリに失敗しました: ${e.message}`,
    )
    .exhaustive();

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
const ensureDirectoryExists = (
  dirPath: string,
): ResultAsync<void, ExportError> =>
  ResultAsync.fromPromise(fs.mkdir(dirPath, { recursive: true }), (e) => ({
    type: 'DIR_CREATE_FAILED' as const,
    path: dirPath,
    message: e instanceof Error ? e.message : String(e),
  })).map(() => undefined);

/**
 * ファイル書き込み（ResultAsync版）
 */
const writeFileSafe = (
  filePath: string,
  content: string,
): ResultAsync<void, ExportError> =>
  ResultAsync.fromPromise(fs.writeFile(filePath, content, 'utf-8'), (e) => ({
    type: 'FILE_WRITE_FAILED' as const,
    path: filePath,
    message: e instanceof Error ? e.message : String(e),
  }));

/**
 * DBからlogStore形式でデータをエクスポート
 * @param options エクスポートオプション
 * @param getDBLogs DB取得関数
 * @returns エクスポート結果
 */
export const exportLogStoreFromDB = async (
  options: ExportLogStoreOptions,
  getDBLogs: DBLogProvider,
): Promise<neverthrow.Result<ExportResult, ExportError>> => {
  const exportStartTime = new Date();

  // DBからログデータを取得（期間指定がない場合は全データ取得）
  const logRecords = await getDBLogs(options.startDate, options.endDate);

  if (logRecords.length === 0) {
    return neverthrow.ok({
      exportedFiles: [],
      totalLogLines: 0,
      exportStartTime,
      exportEndTime: new Date(),
    });
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
      const dirResult = await ensureDirectoryExists(dirPath);
      if (dirResult.isErr()) {
        return neverthrow.err(dirResult.error);
      }

      // ファイルに書き込み
      const content = formatLogStoreContent(logLines);
      const writeResult = await writeFileSafe(filePath, content);
      if (writeResult.isErr()) {
        return neverthrow.err(writeResult.error);
      }

      exportedFiles.push(filePath);
    }
  }

  const exportEndTime = new Date();

  return neverthrow.ok({
    exportedFiles,
    totalLogLines,
    exportStartTime,
    exportEndTime,
  });
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
): Promise<neverthrow.Result<ExportResult, ExportError>> => {
  const exportStartTime = new Date();

  // DBからログデータを取得（期間指定がない場合は全データ取得）
  const logRecords = await getDBLogs(options.startDate, options.endDate);

  if (logRecords.length === 0) {
    return neverthrow.ok({
      exportedFiles: [],
      totalLogLines: 0,
      exportStartTime,
      exportEndTime: new Date(),
    });
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
  const dirResult = await ensureDirectoryExists(dirPath);
  if (dirResult.isErr()) {
    return neverthrow.err(dirResult.error);
  }

  // ファイルに書き込み
  const content = formatLogStoreContent(logLines);
  const writeResult = await writeFileSafe(finalOutputPath, content);
  if (writeResult.isErr()) {
    return neverthrow.err(writeResult.error);
  }

  const exportEndTime = new Date();

  return neverthrow.ok({
    exportedFiles: [finalOutputPath],
    totalLogLines: logLines.length,
    exportStartTime,
    exportEndTime,
  });
};
