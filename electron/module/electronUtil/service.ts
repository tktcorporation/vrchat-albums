import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { writeClipboardFilePaths } from 'clip-filepaths';
import { app, clipboard, dialog, nativeImage, shell } from 'electron';
import * as neverthrow from 'neverthrow';
import { ResultAsync } from 'neverthrow';
import sharp from 'sharp';
import { match, P } from 'ts-pattern';
import { FileIOError } from './error';

// Error types for electronUtil operations
type OpenPathError = { type: 'OPEN_PATH_FAILED'; message: string };

/**
 * downloadImageAsPng のエラー型
 */
export type DownloadImageError =
  | { type: 'CANCELED' }
  | { type: 'SAVE_FILE_FAILED'; message: string }
  | { type: 'PNG_PROCESSING_FAILED'; message: string };

/**
 * shell.openPath() をラップした共通ヘルパー関数。
 * エクスプローラー、フォトビューア、関連付けアプリでの開く操作で共通利用される。
 * shell.openPath() はエラー時に文字列を返し、成功時は空文字列を返す。
 */
const openPathWithShell = async (
  targetPath: string,
): Promise<neverthrow.Result<string, OpenPathError>> => {
  // shell.openPath() returns error message string on failure, empty string on success
  // Any exceptions thrown are unexpected and should propagate to Sentry
  const errorMsg = await shell.openPath(targetPath);
  if (errorMsg) {
    return neverthrow.err({
      type: 'OPEN_PATH_FAILED',
      message: errorMsg,
    });
  }
  return neverthrow.ok('');
};

/**
 * OS のエクスプローラーで指定パスを開くユーティリティ。
 * main プロセスの service モジュール各所から利用される。
 */
const openPathInExplorer = openPathWithShell;

/**
 * アプリケーションのログ保存ディレクトリを取得する。
 * エラーログ閲覧メニューなどで参照される。
 */
export const getApplicationLogPath = (): string => {
  return app.getPath('logs');
};

/**
 * ダウンロードフォルダのパスを取得する。
 * エクスポート機能のデフォルト出力先として利用される。
 */
const getDownloadsPath = (): string => {
  return app.getPath('downloads');
};

/**
 * ファイル/ディレクトリ選択ダイアログを表示する汎用関数。
 * VRChat ログフォルダなどの設定入力で利用される。
 */
const openElectronDialog = async (
  properties: Array<'openDirectory' | 'openFile' | 'multiSelections'>,
): Promise<neverthrow.Result<string[], 'canceled'>> => {
  const result = await dialog.showOpenDialog({
    properties,
  });
  if (result.canceled) {
    return neverthrow.err('canceled');
  }
  return neverthrow.ok(result.filePaths);
};

/**
 * ディレクトリ選択ダイアログを表示し、選択されたパスを返す。
 * 設定画面からフォルダ指定する際に使用される。
 * @deprecated Use openElectronDialog with ['openDirectory'] instead
 */
const openGetDirDialog = async (): Promise<
  neverthrow.Result<string, 'canceled'>
> => {
  const result = await openElectronDialog(['openDirectory']);
  return result.map((paths) => paths[0]);
};

/**
 * ファイル/ディレクトリ選択ダイアログを表示する汎用関数。
 * VRChat ログフォルダなどの設定入力で利用される。
 * @deprecated Use openElectronDialog instead
 */
const openGetFileDialog = async (
  properties: Array<'openDirectory' | 'openFile' | 'multiSelections'>,
): Promise<neverthrow.Result<string[], 'canceled'>> => {
  return openElectronDialog(properties);
};

/**
 * 既定のブラウザで URL を開くシンプルなヘルパー。
 * ShareDialog などからリンクを開く際に使用される。
 */
const openUrlInDefaultBrowser = (url: string) => {
  return shell.openExternal(url);
};

/**
 * 写真ファイルを OS 標準のフォトビューアで開く関数。
 * PhotoCard の"画像で開く"操作などから利用される。
 */
const openPhotoPathWithPhotoApp = openPathWithShell;

/**
 * 拡張子に関連付けられたアプリケーションでファイルを開く関数。
 * エクスプローラーから開く機能などで利用される。
 */
const openPathWithAssociatedApp = openPathWithShell;

/**
 * 画像ファイルを読み込み、クリップボードへ転送する。
 * ShareDialog からのコピー処理で利用される。
 */
const copyImageDataByPath = async (
  filePath: string,
): Promise<neverthrow.Result<void, never>> => {
  // All errors from sharp() and clipboard operations are unexpected
  // and should propagate to Sentry
  const photoBuf = await sharp(filePath).toBuffer();
  const image = nativeImage.createFromBuffer(photoBuf);
  clipboard.writeImage(image);
  // eventEmitter.emit('toast', 'copied'); // service 層からは直接 emit しない
  return neverthrow.ok(undefined);
};

/**
 * Base64 形式の画像を一時保存してからクリップボードへコピーする。
 * ShareDialog の画像コピー機能で利用される。
 */
const copyImageByBase64 = (options: {
  pngBase64: string;
}): ResultAsync<void, FileIOError> => {
  return handlePngBase64WithCallback(
    {
      filenameWithoutExt: 'clipboard_image', // 一時ファイル名
      pngBase64: options.pngBase64,
    },
    async (tempPngPath) => {
      const image = nativeImage.createFromPath(tempPngPath);
      clipboard.writeImage(image);
      // eventEmitter.emit('toast', 'copied'); // service 層からは直接 emit しない
    },
  );
};

/**
 * Base64 画像を一時ファイル化して PNG として保存する処理。
 * プレビュー画像のダウンロード機能から呼び出される。
 */
const downloadImageAsPng = async (options: {
  pngBase64: string;
  filenameWithoutExt: string;
}): Promise<neverthrow.Result<void, DownloadImageError>> => {
  let tempDir = '';
  try {
    const base64Data = options.pngBase64.replace(
      /^data:image\/[^;]+;base64,/,
      '',
    );
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vrchat-photo-'));
    const tempFilePath = path.join(
      tempDir,
      `${options.filenameWithoutExt}.png`,
    );
    const imageBuffer = Buffer.from(base64Data, 'base64');
    await fs.writeFile(tempFilePath, new Uint8Array(imageBuffer));

    const dialogResult = await showSavePngDialog(options.filenameWithoutExt);

    if (dialogResult.canceled || !dialogResult.filePath) {
      await fs
        .rm(tempDir, { recursive: true, force: true })
        .catch(console.error);
      return neverthrow.err({ type: 'CANCELED' });
    }

    const saveResult = await saveFileToPath(
      tempFilePath,
      dialogResult.filePath,
    );
    if (saveResult.isErr()) {
      return neverthrow.err({
        type: 'SAVE_FILE_FAILED',
        message: saveResult.error.message,
      });
    }

    return neverthrow.ok(undefined);
  } catch (error) {
    console.error('Error in downloadImageAsPng:', error);
    // 予期しないエラーは Sentry に送信するために throw
    throw error;
  } finally {
    if (tempDir) {
      await fs
        .rm(tempDir, { recursive: true, force: true })
        .catch(console.error);
    }
  }
};

interface SavePngFileOptions {
  pngBase64: string;
  filenameWithoutExt: string;
}

/**
 * Base64 PNG を一時ファイルとして保存し、指定コールバックへパスを渡す。
 * 画像コピーやダウンロード処理の共通部分として利用される。
 */
export const handlePngBase64WithCallback = (
  options: SavePngFileOptions,
  callback: (tempPngPath: string) => Promise<void>,
): ResultAsync<void, FileIOError> => {
  return ResultAsync.fromPromise(
    (async () => {
      let tempDir = '';
      try {
        const base64Data = options.pngBase64.replace(
          /^data:image\/[^;]+;base64,/,
          '',
        );
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vrchat-photo-'));
        const tempFilePath = path.join(
          tempDir,
          `${options.filenameWithoutExt}.png`,
        );
        const imageBuffer = Buffer.from(base64Data, 'base64');
        await fs.writeFile(tempFilePath, new Uint8Array(imageBuffer));
        await callback(tempFilePath);
      } finally {
        if (tempDir) {
          try {
            await fs.rm(tempDir, { recursive: true, force: true });
          } catch (cleanupError) {
            console.error(
              'Failed to cleanup temporary directory:',
              cleanupError,
            );
          }
        }
      }
    })(),
    (error) =>
      new FileIOError({
        code: match(error)
          .with(
            { code: P.union('EACCES', 'EPERM') },
            () => 'PERMISSION_DENIED' as const,
          )
          .otherwise(() => 'FILE_CREATE_FAILED' as const),
        message: error instanceof Error ? error.message : String(error),
      }),
  );
};

/**
 * PNG ファイル保存用のダイアログを表示する。
 * downloadImageAsPng から呼び出される。
 */
export const showSavePngDialog = async (filenameWithoutExt: string) => {
  return dialog.showSaveDialog({
    defaultPath: path.join(
      os.homedir(),
      'Downloads',
      `${filenameWithoutExt}.png`,
    ),
    filters: [
      { name: 'PNG Image', extensions: ['png'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
};

/**
 * 一時ファイルから指定パスへファイルを保存する単純なヘルパー。
 * downloadImageAsPng 内部で利用される。
 */
export const saveFileToPath = (
  sourcePath: string,
  destinationPath: string,
): ResultAsync<void, FileIOError> => {
  return ResultAsync.fromPromise(
    fs.copyFile(sourcePath, destinationPath),
    (error) =>
      new FileIOError({
        code: 'FILE_COPY_FAILED',
        message: error instanceof Error ? error.message : String(error),
      }),
  );
};

// 複数ファイルをクリップボードにコピーする (クロスプラットフォーム対応)
/**
 * 複数ファイルのパスをクリップボードにコピーするクロスプラットフォーム対応関数。
 * ファイル共有機能などで利用される。
 */
const copyMultipleFilesToClipboard = async (
  filePaths: string[],
): Promise<neverthrow.Result<void, never>> => {
  // All errors are unexpected and should propagate
  if (filePaths.length === 0) {
    return neverthrow.ok(undefined);
  }
  writeClipboardFilePaths(filePaths);

  return neverthrow.ok(undefined);
};

export {
  openPathInExplorer,
  openElectronDialog,
  openGetDirDialog,
  openGetFileDialog,
  openUrlInDefaultBrowser,
  openPhotoPathWithPhotoApp,
  openPathWithAssociatedApp,
  copyImageDataByPath,
  copyImageByBase64,
  downloadImageAsPng,
  copyMultipleFilesToClipboard,
  getDownloadsPath,
};
