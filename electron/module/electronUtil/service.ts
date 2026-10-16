import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { writeClipboardFilePaths } from 'clip-filepaths';
import { Effect } from 'effect';
import type { NativeImage } from 'electron';
import { match, P } from 'ts-pattern';

import {
  getApp,
  getClipboard,
  getClipboardItem,
  getDialog,
  getNativeImage,
  getShell,
} from '../../lib/electronModules';
import { checkExternalUrl } from '../../lib/externalUrl';
import type { FileIOError } from './errors';
import {
  ExternalUrlNotAllowed,
  FileCopyFailed,
  FileCreateFailed,
  OpenPathFailed,
  OperationCanceled,
  PermissionDenied,
} from './errors';

/**
 * shell.openPath() をラップした共通ヘルパー関数。
 * エクスプローラーとフォトビューアでの開く操作で共通利用される。
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
 * 既定のブラウザで URL を開く。ShareDialog などからリンクを開く際に使用される。
 *
 * `shell.openExternal` はスキームに関連付けられた OS のハンドラを起動するため、
 * checkExternalUrl が許可した URL だけを渡す。拒否は入力に起因する予期された失敗なので、
 * Sentry へ送る defect にせず ExternalUrlNotAllowed として値で返す。
 */
const openUrlInDefaultBrowser = (
  url: string,
): Effect.Effect<void, ExternalUrlNotAllowed> => {
  const checked = checkExternalUrl(url);
  if (!checked.ok) {
    return Effect.fail(
      new ExternalUrlNotAllowed({
        message: `External URL rejected: ${checked.rejection.type}`,
        url,
      }),
    );
  }
  // openExternal の reject は OS 側の想定外の失敗なので defect として Sentry へ届ける
  return Effect.promise(() => getShell().openExternal(checked.url));
};

/**
 * 写真ファイルを OS 標準のフォトビューアで開く関数。
 * PhotoCard の"画像で開く"操作などから利用される。
 */
const openPhotoPathWithPhotoApp = openPathWithShell;

/**
 * NativeImage を PNG としてクリップボードへ書き込む。
 * Electron の clipboard は W3C Clipboard API と同じ MIME 型付きの ClipboardItem を受け取るため、
 * 元画像の形式に関わらず PNG へ変換して `image/png` として渡す。
 */
const writeImageToClipboard = (image: NativeImage): Promise<void> => {
  const ClipboardItem = getClipboardItem();
  const png = new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' });
  return getClipboard().write([new ClipboardItem({ 'image/png': png })]);
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
      const image = getNativeImage().createFromPath(tempPngPath);
      await writeImageToClipboard(image);
      // eventEmitter.emit('toast', 'copied'); // service 層からは直接 emit しない
    },
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
 * downloadImageAsPhotoLogPng から呼び出される。
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
 * downloadImageAsPhotoLogPng から呼び出される。
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
  openUrlInDefaultBrowser,
  openPhotoPathWithPhotoApp,
  copyImageByBase64,
  copyMultipleFilesToClipboard,
  getDownloadsPath,
};
