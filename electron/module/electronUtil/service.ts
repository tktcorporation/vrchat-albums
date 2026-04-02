import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { writeClipboardFilePaths } from 'clip-filepaths';
import { Effect } from 'effect';
import { match, P } from 'ts-pattern';

import { getApp, getDialog, getShell } from '../../lib/electronModules';
import type { DownloadImageError, FileIOError } from './errors';
import {
  FileCopyFailed,
  FileCreateFailed,
  OpenPathFailed,
  OperationCanceled,
  PermissionDenied,
  SaveFileFailed,
} from './errors';

/**
 * shell.openPath() をラップした共通ヘルパー関数。
 * エクスプローラー、フォトビューア、関連付けアプリでの開く操作で共通利用される。
 * shell.openPath() はエラー時に文字列を返し、成功時は空文字列を返す。
 */
const openPathWithShell = (
  targetPath: string,
): Effect.Effect<string, OpenPathFailed> => {
  return Effect.gen(function* () {
    // shell.openPath() returns error message string on failure, empty string on success
    // Any exceptions thrown are unexpected and should propagate to Sentry
    const errorMsg = yield* Effect.promise(() =>
      getShell().openPath(targetPath),
    );
    if (errorMsg) {
      return yield* Effect.fail(
        new OpenPathFailed({
          message: errorMsg,
        }),
      );
    }
    return '';
  });
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
  return getApp().getPath('logs');
};

/**
 * ダウンロードフォルダのパスを取得する。
 * エクスポート機能のデフォルト出力先として利用される。
 */
const getDownloadsPath = (): string => {
  return getApp().getPath('downloads');
};

/**
 * ファイル/ディレクトリ選択ダイアログを表示する汎用関数。
 * VRChat ログフォルダなどの設定入力で利用される。
 */
const openElectronDialog = (
  properties: ('openDirectory' | 'openFile' | 'multiSelections')[],
): Effect.Effect<string[], OperationCanceled> => {
  return Effect.gen(function* () {
    const result = yield* Effect.promise(() =>
      getDialog().showOpenDialog({ properties }),
    );
    if (result.canceled) {
      return yield* Effect.fail(new OperationCanceled({}));
    }
    return result.filePaths;
  });
};

/**
 * ディレクトリ選択ダイアログを表示し、選択されたパスを返す。
 * 設定画面からフォルダ指定する際に使用される。
 * @deprecated Use openElectronDialog with ['openDirectory'] instead
 */
const openGetDirDialog = (): Effect.Effect<string, OperationCanceled> => {
  return openElectronDialog(['openDirectory']).pipe(
    Effect.map((paths) => paths[0]),
  );
};

/**
 * ファイル/ディレクトリ選択ダイアログを表示する汎用関数。
 * VRChat ログフォルダなどの設定入力で利用される。
 * @deprecated Use openElectronDialog instead
 */
const openGetFileDialog = (
  properties: ('openDirectory' | 'openFile' | 'multiSelections')[],
): Effect.Effect<string[], OperationCanceled> => {
  return openElectronDialog(properties);
};

/**
 * 既定のブラウザで URL を開くシンプルなヘルパー。
 * ShareDialog などからリンクを開く際に使用される。
 */
const openUrlInDefaultBrowser = (url: string) => {
  return getShell().openExternal(url);
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
const copyImageDataByPath = (filePath: string): Effect.Effect<void> => {
  // clip-filepaths でファイルパスをクリップボードにコピー。
  // OS がファイルコピーとして認識し、エクスプローラー等にペースト可能。
  return Effect.try({
    try: () => writeClipboardFilePaths([filePath]),
    catch: (e) => {
      throw e instanceof Error ? e : new Error(String(e));
    },
  });
};

/**
 * Base64 形式の画像を一時保存してからクリップボードへコピーする。
 * ShareDialog の画像コピー機能で利用される。
 */
const copyImageByBase64 = (options: {
  pngBase64: string;
}): Effect.Effect<void, FileIOError> => {
  return handlePngBase64WithCallback(
    {
      filenameWithoutExt: 'clipboard_image', // 一時ファイル名
      pngBase64: options.pngBase64,
    },
    async (tempPngPath) => {
      writeClipboardFilePaths([tempPngPath]);
    },
  );
};

/**
 * Base64 画像を一時ファイル化して PNG として保存する処理。
 * プレビュー画像のダウンロード機能から呼び出される。
 */
const downloadImageAsPng = (options: {
  pngBase64: string;
  filenameWithoutExt: string;
}): Effect.Effect<void, DownloadImageError> => {
  /**
   * 一時ディレクトリを作成し、画像保存ダイアログを経由して PNG を保存する。
   * Effect.acquireUseRelease で一時ディレクトリのクリーンアップを保証する。
   */
  return Effect.acquireUseRelease(
    // acquire: 一時ディレクトリ作成
    Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), 'vrchat-photo-'))),
    // use: 画像保存処理
    (tempDir) =>
      Effect.gen(function* () {
        const base64Data = options.pngBase64.replace(
          /^data:image\/[^;]+;base64,/,
          '',
        );
        const tempFilePath = path.join(
          tempDir,
          `${options.filenameWithoutExt}.png`,
        );
        const imageBuffer = Buffer.from(base64Data, 'base64');
        yield* Effect.promise(() =>
          fs.writeFile(tempFilePath, new Uint8Array(imageBuffer)),
        );

        const dialogResult = yield* Effect.promise(() =>
          showSavePngDialog(options.filenameWithoutExt),
        );

        if (dialogResult.canceled || !dialogResult.filePath) {
          return yield* Effect.fail(new OperationCanceled({}));
        }

        const saveResult = yield* Effect.either(
          saveFileToPath(tempFilePath, dialogResult.filePath),
        );

        if (saveResult._tag === 'Left') {
          return yield* Effect.fail(
            new SaveFileFailed({
              message: saveResult.left.message,
            }),
          );
        }
      }),
    // release: 一時ディレクトリ削除（成功・失敗に関わらず実行）
    (tempDir) =>
      Effect.promise(() =>
        fs.rm(tempDir, { recursive: true, force: true }).catch(console.error),
      ),
  );
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
): Effect.Effect<void, FileIOError> => {
  const base64Data = options.pngBase64.replace(
    /^data:image\/[^;]+;base64,/,
    '',
  );

  return Effect.acquireUseRelease(
    // acquire: 一時ディレクトリを作成
    Effect.tryPromise({
      try: () => fs.mkdtemp(path.join(os.tmpdir(), 'vrchat-photo-')),
      catch: (error) =>
        match(error)
          .with(
            { code: P.union('EACCES', 'EPERM') },
            (e) =>
              new PermissionDenied({
                message: e instanceof Error ? e.message : JSON.stringify(e),
              }),
          )
          .otherwise(
            (e) =>
              new FileCreateFailed({
                message: e instanceof Error ? e.message : JSON.stringify(e),
              }),
          ),
    }),
    // use: ファイル書き込み → コールバック実行
    (tempDir) =>
      Effect.tryPromise({
        try: async () => {
          const tempFilePath = path.join(
            tempDir,
            `${options.filenameWithoutExt}.png`,
          );
          const imageBuffer = Buffer.from(base64Data, 'base64');
          await fs.writeFile(tempFilePath, new Uint8Array(imageBuffer));
          await callback(tempFilePath);
        },
        catch: (error) =>
          match(error)
            .with(
              { code: P.union('EACCES', 'EPERM') },
              (e) =>
                new PermissionDenied({
                  message: e instanceof Error ? e.message : JSON.stringify(e),
                }),
            )
            .otherwise(
              (e) =>
                new FileCreateFailed({
                  message: e instanceof Error ? e.message : JSON.stringify(e),
                }),
            ),
      }),
    // release: 一時ディレクトリ削除（成功・失敗問わず必ず実行）
    (tempDir) =>
      Effect.promise(async () => {
        await fs
          .rm(tempDir, { recursive: true, force: true })
          .catch((cleanupError) => {
            console.error(
              'Failed to cleanup temporary directory:',
              cleanupError,
            );
          });
      }),
  );
};

/**
 * PNG ファイル保存用のダイアログを表示する。
 * downloadImageAsPng から呼び出される。
 */
export const showSavePngDialog = async (filenameWithoutExt: string) => {
  return getDialog().showSaveDialog({
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
): Effect.Effect<void, FileCopyFailed> => {
  return Effect.tryPromise({
    try: () => fs.copyFile(sourcePath, destinationPath),
    catch: (error) =>
      new FileCopyFailed({
        message: error instanceof Error ? error.message : String(error),
      }),
  });
};

// 複数ファイルをクリップボードにコピーする (クロスプラットフォーム対応)
/**
 * 複数ファイルのパスをクリップボードにコピーするクロスプラットフォーム対応関数。
 * ファイル共有機能などで利用される。
 */
const copyMultipleFilesToClipboard = (
  filePaths: string[],
): Effect.Effect<void> => {
  // All errors are unexpected and should propagate
  if (filePaths.length === 0) {
    return Effect.void;
  }
  return Effect.sync(() => {
    writeClipboardFilePaths(filePaths);
  });
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
