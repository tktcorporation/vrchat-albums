import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as datefns from 'date-fns';
import * as neverthrow from 'neverthrow';
import { ResultAsync } from 'neverthrow';
import { match } from 'ts-pattern';
import {
  getLogStoreDir,
  getLogStoreFilePathsInRange,
} from '../fileHandlers/logStorageManager';

/**
 * logStoreからファイルをコピーしてエクスポートするサービス
 */

/**
 * エクスポートエラー型
 */
export type ExportError =
  | { type: 'DIR_CREATE_FAILED'; path: string; message: string }
  | { type: 'FILE_WRITE_FAILED'; path: string; message: string }
  | { type: 'FILE_READ_FAILED'; path: string; message: string }
  | { type: 'FILE_COPY_FAILED'; src: string; dest: string; message: string }
  | { type: 'NO_LOGSTORE_FILES'; message: string };

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
      { type: 'FILE_READ_FAILED' },
      (e) => `ファイル読み込みに失敗しました: ${e.path} (${e.message})`,
    )
    .with(
      { type: 'FILE_COPY_FAILED' },
      (e) =>
        `ファイルコピーに失敗しました: ${e.src} → ${e.dest} (${e.message})`,
    )
    .with(
      { type: 'NO_LOGSTORE_FILES' },
      (e) => `エクスポート対象のログファイルがありません: ${e.message}`,
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
 * ファイルコピー（ResultAsync版）
 */
const copyFileSafe = (
  src: string,
  dest: string,
): ResultAsync<void, ExportError> =>
  ResultAsync.fromPromise(fs.copyFile(src, dest), (e) => ({
    type: 'FILE_COPY_FAILED' as const,
    src,
    dest,
    message: e instanceof Error ? e.message : String(e),
  }));

/**
 * ファイルの行数をカウント
 */
const countFileLines = async (filePath: string): Promise<number> => {
  const content = await fs.readFile(filePath, 'utf-8');
  return content.split('\n').filter((line) => line.trim().length > 0).length;
};

/**
 * logStoreからファイルをコピーしてエクスポート
 *
 * DBからの変換ではなく、logStoreディレクトリから直接ファイルをコピーすることで:
 * - 変換時のバグリスクを回避
 * - VRChatログ仕様変更への耐性を確保
 * - exit ログなどDBに保存されないログも保持
 *
 * @param options エクスポートオプション
 * @returns エクスポート結果
 * @see https://github.com/tktcorporation/vrchat-albums/issues/477
 */
export const exportLogStore = async (
  options: ExportLogStoreOptions,
): Promise<neverthrow.Result<ExportResult, ExportError>> => {
  const exportStartTime = new Date();

  // 期間を決定（指定がない場合は全期間）
  const startDate = options.startDate ?? new Date(2000, 0, 1);
  const endDate = options.endDate ?? new Date();

  // 対象期間のlogStoreファイルを取得
  const logStoreFiles = await getLogStoreFilePathsInRange(startDate, endDate);

  if (logStoreFiles.length === 0) {
    return neverthrow.ok({
      exportedFiles: [],
      totalLogLines: 0,
      exportStartTime,
      exportEndTime: new Date(),
    });
  }

  const exportedFiles: string[] = [];
  let totalLogLines = 0;

  const logStoreDir = getLogStoreDir();

  // 各ファイルをエクスポート先にコピー
  for (const logStoreFile of logStoreFiles) {
    const srcPath = logStoreFile.value;

    // 相対パスを計算（logStoreディレクトリからの相対パス）
    const relativePath = path.relative(logStoreDir, srcPath);

    // エクスポート先パスを生成
    const basePath = options.outputBasePath || getDefaultLogStorePath();
    const exportFolder = generateExportFolderName(exportStartTime);
    const destPath = path.join(basePath, exportFolder, relativePath);

    // ディレクトリを作成
    const dirPath = path.dirname(destPath);
    const dirResult = await ensureDirectoryExists(dirPath);
    if (dirResult.isErr()) {
      return neverthrow.err(dirResult.error);
    }

    // ファイルをコピー
    const copyResult = await copyFileSafe(srcPath, destPath);
    if (copyResult.isErr()) {
      return neverthrow.err(copyResult.error);
    }

    // 行数をカウント
    totalLogLines += await countFileLines(srcPath);

    exportedFiles.push(destPath);
  }

  const exportEndTime = new Date();

  return neverthrow.ok({
    exportedFiles,
    totalLogLines,
    exportStartTime,
    exportEndTime,
  });
};
