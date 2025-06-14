import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { writeClipboardFilePaths } from 'clip-filepaths';
import { app, clipboard, dialog, nativeImage, shell } from 'electron';
import * as neverthrow from 'neverthrow';
import sharp from 'sharp';

/**
 * OS のエクスプローラーで指定パスを開くユーティリティ。
 * main プロセスの service モジュール各所から利用される。
 */
const openPathInExplorer = async (
  path: string,
): Promise<neverthrow.Result<string, Error>> => {
  // ネイティブの機能を使う
  try {
    const result = await shell.openPath(path);
    return neverthrow.ok(result);
  } catch (error) {
    if (error instanceof Error) {
      return neverthrow.err(error);
    }
    throw error;
  }
};

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
 * ディレクトリ選択ダイアログを表示し、選択されたパスを返す。
 * 設定画面からフォルダ指定する際に使用される。
 */
const openGetDirDialog = async (): Promise<
  neverthrow.Result<string, 'canceled'>
> => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
  });
  if (result.canceled) {
    return neverthrow.err('canceled');
  }
  return neverthrow.ok(result.filePaths[0]);
};

/**
 * ファイル/ディレクトリ選択ダイアログを表示する汎用関数。
 * VRChat ログフォルダなどの設定入力で利用される。
 */
const openGetFileDialog = async (
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
const openPhotoPathWithPhotoApp = async (
  filePath: string,
): Promise<neverthrow.Result<string, Error>> => {
  try {
    const errorMsg = await shell.openPath(filePath);
    if (errorMsg) {
      return neverthrow.err(new Error(`Failed to open path: ${errorMsg}`));
    }
    return neverthrow.ok('');
  } catch (error) {
    return neverthrow.err(
      error instanceof Error ? error : new Error('Unknown error opening path'),
    );
  }
};

/**
 * 拡張子に関連付けられたアプリケーションでファイルを開く関数。
 * エクスプローラーから開く機能などで利用される。
 */
const openPathWithAssociatedApp = async (
  filePath: string,
): Promise<neverthrow.Result<string, Error>> => {
  try {
    // openPath はデフォルトアプリで開くので、これで代用可能
    const errorMsg = await shell.openPath(filePath);
    if (errorMsg) {
      return neverthrow.err(new Error(`Failed to open path: ${errorMsg}`));
    }
    return neverthrow.ok('');
  } catch (error) {
    return neverthrow.err(
      error instanceof Error ? error : new Error('Unknown error opening path'),
    );
  }
};

/**
 * 画像ファイルを読み込み、クリップボードへ転送する。
 * ShareDialog からのコピー処理で利用される。
 */
const copyImageDataByPath = async (
  filePath: string,
): Promise<neverthrow.Result<void, Error>> => {
  try {
    const photoBuf = await sharp(filePath).toBuffer();
    const image = nativeImage.createFromBuffer(photoBuf);
    clipboard.writeImage(image);
    // eventEmitter.emit('toast', 'copied'); // service 層からは直接 emit しない
    return neverthrow.ok(undefined);
  } catch (error) {
    return neverthrow.err(
      error instanceof Error ? error : new Error('Failed to copy image data'),
    );
  }
};

/**
 * Base64 形式の画像を一時保存してからクリップボードへコピーする。
 * ShareDialog の画像コピー機能で利用される。
 */
const copyImageByBase64 = async (options: {
  pngBase64: string;
}): Promise<neverthrow.Result<void, Error>> => {
  try {
    await handlePngBase64WithCallback(
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
    return neverthrow.ok(undefined);
  } catch (error) {
    return neverthrow.err(
      error instanceof Error ? error : new Error('Failed to copy base64 image'),
    );
  }
};

/**
 * Base64 画像を一時ファイル化して PNG として保存する処理。
 * プレビュー画像のダウンロード機能から呼び出される。
 */
const downloadImageAsPng = async (options: {
  pngBase64: string;
  filenameWithoutExt: string;
}): Promise<neverthrow.Result<void, Error | 'canceled'>> => {
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
      return neverthrow.err('canceled');
    }

    await saveFileToPath(tempFilePath, dialogResult.filePath);

    return neverthrow.ok(undefined);
  } catch (error) {
    console.error('Error in downloadImageAsPng:', error);
    if (error instanceof Error && error.message === 'canceled') {
      return neverthrow.err('canceled');
    }
    return neverthrow.err(
      error instanceof Error
        ? new Error('Failed to handle png file', { cause: error })
        : new Error('Failed to handle png file'),
    );
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
export const handlePngBase64WithCallback = async (
  options: SavePngFileOptions,
  callback: (tempPngPath: string) => Promise<void>,
): Promise<void> => {
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
  } catch (error) {
    console.error('Failed to handle png file:', error);
    throw new Error('Failed to handle png file', { cause: error });
  } finally {
    if (tempDir) {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.error('Failed to cleanup temporary directory:', cleanupError);
      }
    }
  }
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
export const saveFileToPath = async (
  sourcePath: string,
  destinationPath: string,
): Promise<void> => {
  await fs.copyFile(sourcePath, destinationPath);
};

// 複数ファイルをクリップボードにコピーする (クロスプラットフォーム対応)
/**
 * 複数ファイルのパスをクリップボードにコピーするクロスプラットフォーム対応関数。
 * ファイル共有機能などで利用される。
 */
const copyMultipleFilesToClipboard = async (
  filePaths: string[],
): Promise<neverthrow.Result<void, Error>> => {
  if (filePaths.length === 0) {
    return neverthrow.ok(undefined);
  }
  writeClipboardFilePaths(filePaths);

  return neverthrow.ok(undefined);
};

export {
  openPathInExplorer,
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
