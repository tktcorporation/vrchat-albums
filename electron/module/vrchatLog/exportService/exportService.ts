import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as datefns from 'date-fns';
import { Effect } from 'effect';
import { match } from 'ts-pattern';
import {
  exportLogsToLogStore,
  formatLogStoreContent,
  type LogRecord,
} from '../converters/dbToLogStore';
import {
  ExportDbQueryFailed,
  ExportDirCreateFailed,
  ExportFileWriteFailed,
  type ExportServiceError,
} from './errors';

/**
 * DBからlogStore形式でエクスポートするサービス
 */

/**
 * ExportServiceErrorからユーザー向けメッセージを取得
 */
export const getExportErrorMessage = (error: ExportServiceError): string =>
  match(error)
    .with(
      { _tag: 'ExportDirCreateFailed' },
      (e) => `ディレクトリ作成に失敗しました: ${e.path} (${e.message})`,
    )
    .with(
      { _tag: 'ExportFileWriteFailed' },
      (e) => `ファイル書き込みに失敗しました: ${e.path} (${e.message})`,
    )
    .with(
      { _tag: 'ExportDbQueryFailed' },
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
 * Electronのダウンロードパスを安全に取得
 * テスト環境などでappが利用できない場合はnullを返す
 */
const getElectronDownloadsPath = (): string | null => {
  // Playwright テスト互換性のため遅延評価
  // @see CLAUDE.md Electron Module Import パターン
  const electronApp = (() => {
    try {
      return require('electron').app;
    } catch {
      return null;
    }
  })();

  if (!electronApp) return null;

  try {
    return electronApp.getPath('downloads');
  } catch {
    return null;
  }
};

/**
 * デフォルトのlogStoreディレクトリパスを取得
 */
const getDefaultLogStorePath = (): string => {
  const downloadsPath = getElectronDownloadsPath();
  if (downloadsPath) {
    return path.join(downloadsPath, 'logStore');
  }
  // テスト環境などでappが利用できない場合のフォールバック
  return path.join(process.cwd(), 'logStore');
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
): Effect.Effect<void, ExportServiceError> =>
  Effect.tryPromise({
    try: () => fs.mkdir(dirPath, { recursive: true }).then(() => undefined),
    catch: (e) =>
      new ExportDirCreateFailed({
        path: dirPath,
        message: e instanceof Error ? e.message : String(e),
      }),
  });

/**
 * ファイル書き込み（Effect版）
 */
const writeFileSafe = (
  filePath: string,
  content: string,
): Effect.Effect<void, ExportServiceError> =>
  Effect.tryPromise({
    try: () => fs.writeFile(filePath, content, 'utf-8'),
    catch: (e) =>
      new ExportFileWriteFailed({
        path: filePath,
        message: e instanceof Error ? e.message : String(e),
      }),
  });

/**
 * DBからlogStore形式でデータをエクスポート
 * @param options エクスポートオプション
 * @param getDBLogs DB取得関数
 * @returns エクスポート結果
 */
export const exportLogStoreFromDB = (
  options: ExportLogStoreOptions,
  getDBLogs: DBLogProvider,
): Effect.Effect<ExportResult, ExportServiceError> =>
  Effect.gen(function* () {
    const exportStartTime = new Date();

    // DBからログデータを取得（期間指定がない場合は全データ取得）
    const logRecords = yield* Effect.tryPromise({
      try: () => getDBLogs(options.startDate, options.endDate),
      catch: (e) =>
        new ExportDbQueryFailed({
          message: e instanceof Error ? e.message : String(e),
        }),
    });

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
        yield* ensureDirectoryExists(dirPath);

        // ファイルに書き込み
        const content = formatLogStoreContent(logLines);
        yield* writeFileSafe(filePath, content);

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
  });

/**
 * 単一ファイルとしてlogStoreデータをエクスポート
 * @param options エクスポートオプション
 * @param getDBLogs DB取得関数
 * @param outputFilePath 出力ファイルパス
 * @returns エクスポート結果
 */
export const exportLogStoreToSingleFile = (
  options: ExportLogStoreOptions,
  getDBLogs: DBLogProvider,
  outputFilePath: string,
): Effect.Effect<ExportResult, ExportServiceError> =>
  Effect.gen(function* () {
    const exportStartTime = new Date();

    // DBからログデータを取得（期間指定がない場合は全データ取得）
    const logRecords = yield* Effect.tryPromise({
      try: () => getDBLogs(options.startDate, options.endDate),
      catch: (e) =>
        new ExportDbQueryFailed({
          message: e instanceof Error ? e.message : String(e),
        }),
    });

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
    yield* ensureDirectoryExists(dirPath);

    // ファイルに書き込み
    const content = formatLogStoreContent(logLines);
    yield* writeFileSafe(finalOutputPath, content);

    const exportEndTime = new Date();

    return {
      exportedFiles: [finalOutputPath],
      totalLogLines: logLines.length,
      exportStartTime,
      exportEndTime,
    };
  });
