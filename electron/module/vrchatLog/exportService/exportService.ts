import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as datefns from 'date-fns';
import * as neverthrow from 'neverthrow';
import { ResultAsync } from 'neverthrow';
import { match } from 'ts-pattern';
import { getLogStoreFilePathsInRange } from '../fileHandlers/logStorageManager';

/**
 * logStoreファイルを直接コピーしてエクスポートするサービス
 */

/**
 * エクスポートエラー型
 */
export type ExportError =
  | { type: 'DIR_CREATE_FAILED'; path: string; message: string }
  | { type: 'FILE_COPY_FAILED'; src: string; dest: string; message: string }
  | { type: 'FILE_READ_FAILED'; path: string; message: string }
  | {
      type: 'FILE_VERIFY_FAILED';
      src: string;
      dest: string;
      expectedSize: number;
      actualSize: number;
    }
  | { type: 'MANIFEST_WRITE_FAILED'; path: string; message: string };

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
      { type: 'FILE_COPY_FAILED' },
      (e) =>
        `ファイルコピーに失敗しました: ${e.src} → ${e.dest} (${e.message})`,
    )
    .with(
      { type: 'FILE_READ_FAILED' },
      (e) => `ファイル読み込みに失敗しました: ${e.path} (${e.message})`,
    )
    .with(
      { type: 'FILE_VERIFY_FAILED' },
      (e) =>
        `ファイルコピーの検証に失敗しました: ${e.dest} (期待サイズ: ${e.expectedSize}, 実際サイズ: ${e.actualSize})`,
    )
    .with(
      { type: 'MANIFEST_WRITE_FAILED' },
      (e) => `マニフェストの書き込みに失敗しました: ${e.path} (${e.message})`,
    )
    .exhaustive();

export interface ExportLogStoreOptions {
  startDate?: Date;
  endDate?: Date;
  outputBasePath?: string;
}

export interface ExportManifest {
  version: 1;
  status: 'completed';
  exportDateTime: string;
  files: Array<{ relativePath: string; sizeBytes: number }>;
  totalLogLines: number;
}

export interface ExportResult {
  exportedFiles: string[];
  totalLogLines: number;
  exportStartTime: Date;
  exportEndTime: Date;
  manifestPath: string;
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
 * コピー後のファイルサイズを検証
 * ソースと宛先のファイルサイズが一致することを確認
 */
const verifyFileCopy = (
  src: string,
  dest: string,
): ResultAsync<void, ExportError> =>
  ResultAsync.fromPromise(
    Promise.all([fs.stat(src), fs.stat(dest)]).then(([srcStat, destStat]) => {
      if (srcStat.size !== destStat.size) {
        throw {
          type: 'SIZE_MISMATCH' as const,
          srcSize: srcStat.size,
          destSize: destStat.size,
        };
      }
    }),
    (e): ExportError => {
      if (
        typeof e === 'object' &&
        e !== null &&
        'type' in e &&
        (e as { type: string }).type === 'SIZE_MISMATCH'
      ) {
        const mismatch = e as {
          type: string;
          srcSize: number;
          destSize: number;
        };
        return {
          type: 'FILE_VERIFY_FAILED',
          src,
          dest,
          expectedSize: mismatch.srcSize,
          actualSize: mismatch.destSize,
        };
      }
      return {
        type: 'FILE_VERIFY_FAILED',
        src,
        dest,
        expectedSize: -1,
        actualSize: -1,
      };
    },
  );

/**
 * エクスポートマニフェストを書き出す
 */
const writeExportManifest = (
  exportDir: string,
  manifest: ExportManifest,
): ResultAsync<string, ExportError> => {
  const manifestPath = path.join(exportDir, 'export-manifest.json');
  return ResultAsync.fromPromise(
    fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8'),
    (e) => ({
      type: 'MANIFEST_WRITE_FAILED' as const,
      path: manifestPath,
      message: e instanceof Error ? e.message : String(e),
    }),
  ).map(() => manifestPath);
};

/**
 * ファイルの非空行数をカウント
 * logStoreファイルは最大10MBなので readFile で十分
 */
const countFileLines = (filePath: string): ResultAsync<number, ExportError> =>
  ResultAsync.fromPromise(
    fs.readFile(filePath, 'utf-8').then((content) => {
      return content.split('\n').filter((line) => line.trim() !== '').length;
    }),
    (e) => ({
      type: 'FILE_READ_FAILED' as const,
      path: filePath,
      message: e instanceof Error ? e.message : String(e),
    }),
  );

/**
 * logStoreファイルを直接コピーしてエクスポート
 * @param options エクスポートオプション
 * @returns エクスポート結果
 */
export const exportLogStore = async (
  options: ExportLogStoreOptions,
): Promise<neverthrow.Result<ExportResult, ExportError>> => {
  const exportStartTime = new Date();

  // 日付範囲のデフォルト値を設定
  const startDate = options.startDate ?? new Date(0);
  const endDate = options.endDate ?? new Date();

  // logStoreファイルを取得
  const sourceFiles = await getLogStoreFilePathsInRange(startDate, endDate);

  if (sourceFiles.length === 0) {
    return neverthrow.ok({
      exportedFiles: [],
      totalLogLines: 0,
      exportStartTime,
      exportEndTime: new Date(),
      manifestPath: '',
    });
  }

  // エクスポート先パスを構築
  const basePath = options.outputBasePath ?? getDefaultLogStorePath();
  const exportFolderName = generateExportFolderName(exportStartTime);
  const exportDir = path.join(basePath, exportFolderName);

  const exportedFiles: string[] = [];
  const manifestFiles: Array<{ relativePath: string; sizeBytes: number }> = [];
  let totalLogLines = 0;

  for (const sourceFile of sourceFiles) {
    // 年月をファイルパスから取得
    const yearMonth = sourceFile.getYearMonth();
    const fileName = path.basename(sourceFile.value);

    // 年月が取得できない場合（レガシーファイル等）はルートに配置
    const destDir = yearMonth ? path.join(exportDir, yearMonth) : exportDir;
    const destFile = path.join(destDir, fileName);

    // ディレクトリ作成
    const dirResult = await ensureDirectoryExists(destDir);
    if (dirResult.isErr()) {
      return neverthrow.err(dirResult.error);
    }

    // ファイルコピー
    const copyResult = await copyFileSafe(sourceFile.value, destFile);
    if (copyResult.isErr()) {
      return neverthrow.err(copyResult.error);
    }

    // コピー後のファイルサイズ検証
    const verifyResult = await verifyFileCopy(sourceFile.value, destFile);
    if (verifyResult.isErr()) {
      return neverthrow.err(verifyResult.error);
    }

    // 行数カウント（コピー先を読むことで実際にエクスポートされたものをカウント）
    const lineCountResult = await countFileLines(destFile);
    if (lineCountResult.isErr()) {
      return neverthrow.err(lineCountResult.error);
    }

    // マニフェスト用のファイル情報を収集
    const destStat = await fs.stat(destFile);
    const relativePath = yearMonth ? path.join(yearMonth, fileName) : fileName;
    manifestFiles.push({
      relativePath,
      sizeBytes: destStat.size,
    });

    totalLogLines += lineCountResult.value;
    exportedFiles.push(destFile);
  }

  const exportEndTime = new Date();

  // エクスポート完了マニフェストを書き出す
  const manifest: ExportManifest = {
    version: 1,
    status: 'completed',
    exportDateTime: exportEndTime.toISOString(),
    files: manifestFiles,
    totalLogLines,
  };

  const manifestResult = await writeExportManifest(exportDir, manifest);
  if (manifestResult.isErr()) {
    return neverthrow.err(manifestResult.error);
  }

  return neverthrow.ok({
    exportedFiles,
    totalLogLines,
    exportStartTime,
    exportEndTime,
    manifestPath: manifestResult.value,
  });
};
