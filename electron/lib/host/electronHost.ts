import * as os from 'node:os';
import * as path from 'node:path';

import { Effect } from 'effect';
import type Electron from 'electron';

import {
  getApp,
  getClipboard,
  getClipboardItem,
  getDialog,
  getNativeImage,
  getNotification,
  getShell,
} from '../electronModules';
import { logger } from '../logger';
import type { HostInfo, HostPaths, HostShell } from './types';

/** 殻の情報を読み出す `app` の部分。テストが偽物の app を渡せるよう、使う操作だけに絞る */
type HostInfoSource = Pick<
  Electron.App,
  'getPath' | 'getVersion' | 'getAppPath' | 'isPackaged'
>;

/**
 * 同梱リソースのディレクトリを決める。
 *
 * パッケージ時は electron-builder が `extraResources` を `process.resourcesPath` へ置く。
 * 開発時はソースの `electron/resources` を直接読む。開発時の `app.getAppPath()` は
 * リポジトリの直下（package.json のあるディレクトリ）を返し、ビルド後のバンドルがある
 * `main/` の位置に左右されない。
 */
const resolveResourcesPath = (app: HostInfoSource): string =>
  app.isPackaged
    ? process.resourcesPath
    : path.join(app.getAppPath(), 'electron', 'resources');

/**
 * 無くても起動を続けられるディレクトリと、`app.getPath()` が失敗したときの代わり。
 *
 * Windows では、ダウンロードやピクチャの既知フォルダーの登録が壊れていたり、届かない
 * ネットワーク共有へ移されていたりすると `app.getPath()` が例外を投げる。起動時に
 * 1 度だけ読むので、ここで止めるとアプリ全体が起動しない。そのフォルダーを使う機能
 * （エクスポートの既定の出力先・写真フォルダーの既定値・サムネイルのキャッシュ）だけが
 * 代わりのディレクトリで動くようにする。
 */
const OPTIONAL_PATH_FALLBACKS = {
  // エクスポートの既定の出力先（`<downloads>/logStore`）の代わりに作業ディレクトリを使う
  downloads: () => process.cwd(),
  // Windows の既定のピクチャフォルダーの場所
  pictures: () =>
    path.join(process.env.USERPROFILE ?? os.homedir(), 'Pictures'),
  temp: () => os.tmpdir(),
} as const satisfies Record<
  Exclude<keyof HostPaths, 'userData' | 'logs'>,
  () => string
>;

const readOptionalPath = (
  app: HostInfoSource,
  name: keyof typeof OPTIONAL_PATH_FALLBACKS,
): string =>
  Effect.runSync(
    Effect.try({
      try: () => app.getPath(name),
      catch: (error) =>
        error instanceof Error ? error : new Error(String(error)),
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          const fallback = OPTIONAL_PATH_FALLBACKS[name]();
          logger.warn({
            message: `app.getPath('${name}') failed, using ${fallback} instead`,
            stack: error,
          });
          return fallback;
        }),
      ),
    ),
  );

/**
 * 殻の情報を `app` から読み出す。
 *
 * userData は設定と DB の保存先で、代わりの場所に書くと前回までのデータが見えなくなる。
 * logs は前回までのログと同じ場所に書き続けるため、代わりの場所を使わない。
 * どちらも読めなければ例外のまま起動を止める。
 */
export const createElectronHostInfo = (app: HostInfoSource): HostInfo => ({
  paths: {
    userData: app.getPath('userData'),
    logs: app.getPath('logs'),
    downloads: readOptionalPath(app, 'downloads'),
    pictures: readOptionalPath(app, 'pictures'),
    temp: readOptionalPath(app, 'temp'),
  },
  appVersion: app.getVersion(),
  isPackaged: app.isPackaged,
  resourcesPath: resolveResourcesPath(app),
});

/**
 * 殻の操作のうち、main プロセスのウィンドウとエラー監視を扱うもの。
 *
 * どちらも `electron/electronUtil.ts` や `@sentry/electron/main` を読み込む殻の本体にあり、
 * この関数から直接 import すると、OS の操作だけを確かめたいテストまでそれらを読み込む。
 * 殻を組み立てる側（`electron/index.ts`）から関数として受け取る。
 */
export interface ElectronHostDeps {
  /** メインウィンドウを再読み込みする */
  readonly reloadWindow: () => void;
  /** 規約への同意を受けて、同意を前提にする殻の機能を有効にする */
  readonly onTermsAccepted: () => void;
}

export const createElectronHostShell = (deps: ElectronHostDeps): HostShell => ({
  openPath: (targetPath) => getShell().openPath(targetPath),
  openExternal: (url) => getShell().openExternal(url),
  showOpenDialog: async (properties) => {
    const result = await getDialog().showOpenDialog({
      properties: [...properties],
    });
    if (result.canceled) {
      return { canceled: true };
    }
    return { canceled: false, filePaths: result.filePaths };
  },
  showSaveDialog: async (options) => {
    const result = await getDialog().showSaveDialog({
      defaultPath: options.defaultPath,
      filters: options.filters.map((filter) => ({
        name: filter.name,
        extensions: [...filter.extensions],
      })),
    });
    // Electron は保存先が決まらなかったときに空文字列の filePath を返すことがあるため、
    // 空文字列もキャンセルとして扱い、呼び出し側が空のパスへ書き込まないようにする
    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }
    return { canceled: false, filePath: result.filePath };
  },
  writeClipboardImageFromPngFile: async (pngPath) => {
    // Electron の clipboard は W3C Clipboard API と同じ MIME 型付きの ClipboardItem を受け取るため、
    // 元画像の形式に関わらず PNG へ変換して `image/png` として渡す
    const image = getNativeImage().createFromPath(pngPath);
    const ClipboardItem = getClipboardItem();
    const png = new Blob([new Uint8Array(image.toPNG())], {
      type: 'image/png',
    });
    await getClipboard().write([new ClipboardItem({ 'image/png': png })]);
  },
  writeClipboardText: async (text) => {
    await getClipboard().writeText(text);
  },
  notify: async ({ title, body }) => {
    const Notification = getNotification();
    new Notification({ title, body }).show();
  },
  getOpenAtLogin: async () => getApp().getLoginItemSettings().openAtLogin,
  setOpenAtLogin: async (openAtLogin) => {
    getApp().setLoginItemSettings({ openAtLogin });
  },
  reloadWindow: async () => {
    deps.reloadWindow();
  },
  onTermsAccepted: async () => {
    deps.onTermsAccepted();
  },
});
