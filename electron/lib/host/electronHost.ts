import * as path from 'pathe';

import {
  getApp,
  getClipboard,
  getClipboardItem,
  getDialog,
  getNativeImage,
  getNotification,
  getShell,
} from '../electronModules';
import type { Host, HostInfo, HostShell } from './types';

/**
 * 同梱リソースのディレクトリを決める。
 *
 * パッケージ時は electron-builder が `extraResources` を `process.resourcesPath` へ置く。
 * 開発時はソースの `electron/resources` を直接読む（ビルド後の main/ でも、
 * ソース上の electron/lib/host/ でも、2 階層上が基準になる）。
 */
const resolveResourcesPath = (isPackaged: boolean): string =>
  isPackaged ? process.resourcesPath : path.join(__dirname, '../../resources');

const createElectronHostInfo = (): HostInfo => {
  const app = getApp();
  return {
    paths: {
      userData: app.getPath('userData'),
      logs: app.getPath('logs'),
      downloads: app.getPath('downloads'),
      pictures: app.getPath('pictures'),
      temp: app.getPath('temp'),
    },
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    resourcesPath: resolveResourcesPath(app.isPackaged),
  };
};

const electronHostShell: HostShell = {
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
};

/**
 * Electron の main プロセスで動く殻の実装。
 *
 * `electron/index.ts` が起動直後に `registerHost(createElectronHost())` で登録する。
 * `app.getPath()` などはこの関数を呼んだ時点で読むので、`app` が使えるプロセスで呼ぶ。
 */
export const createElectronHost = (): Host => ({
  info: createElectronHostInfo(),
  shell: electronHostShell,
});
