/**
 * Electrobun 互換レイヤー。
 *
 * 背景: 既存コードが `require('electron')` で取得していた API を
 * Electrobun の API にマッピングする。electronModules.ts や wrappedApp.ts
 * の代替として、各モジュールから利用される。
 *
 * Electron から Electrobun への段階的移行を可能にするため、
 * 同じインターフェースを維持しつつ実装を切り替える。
 *
 * 不要になれば: Electrobun API を直接利用するよう各呼び出し元を修正して削除可能
 */
import { Utils } from 'electrobun/bun';

/**
 * Electron の app.getPath() に相当するパス取得関数。
 * Electrobun の Utils.paths にマッピングする。
 */
export const getPath = (
  name:
    | 'userData'
    | 'logs'
    | 'home'
    | 'appData'
    | 'temp'
    | 'downloads'
    | 'documents'
    | 'pictures'
    | 'desktop',
): string => {
  switch (name) {
    case 'userData':
      return Utils.paths.userData;
    case 'logs':
      return Utils.paths.userLogs;
    case 'home':
      return Utils.paths.home;
    case 'appData':
      return Utils.paths.appData;
    case 'temp':
      return Utils.paths.temp;
    case 'downloads':
      return Utils.paths.downloads;
    case 'documents':
      return Utils.paths.documents;
    case 'pictures':
      return Utils.paths.pictures;
    case 'desktop':
      return Utils.paths.desktop;
  }
};

/**
 * Electron の app.getPath('userData') に相当。
 */
export const getAppUserDataPath = (): string => getPath('userData');

/**
 * Electron の app.isPackaged に相当。
 * Electrobun では NODE_ENV で判定する。
 */
export const isPackaged = (): boolean => process.env.NODE_ENV === 'production';

/**
 * Electron の app.getPath('logs') に相当。
 */
export const getLogPath = (): string => getPath('logs');

/**
 * Electron の shell.openExternal() に相当。
 */
export const openExternal = async (url: string): Promise<void> => {
  Utils.openExternal(url);
};

/**
 * Electron の shell.openPath() に相当。
 */
export const openPath = async (filePath: string): Promise<string> => {
  Utils.openPath(filePath);
  return '';
};

/**
 * Electron の shell.showItemInFolder() に相当。
 */
export const showItemInFolder = (filePath: string): void => {
  Utils.showItemInFolder(filePath);
};

/**
 * Electron の dialog.showOpenDialog() に相当。
 * Electrobun の Utils.openFileDialog() にマッピング。
 */
export const showOpenDialog = async (_options: {
  properties?: ('openDirectory' | 'openFile' | 'multiSelections')[];
}): Promise<{ canceled: boolean; filePaths: string[] }> => {
  try {
    const result = await Utils.openFileDialog({});
    if (!result || result.length === 0) {
      return { canceled: true, filePaths: [] };
    }
    return {
      canceled: false,
      filePaths: Array.isArray(result) ? result : [result],
    };
  } catch {
    return { canceled: true, filePaths: [] };
  }
};

/**
 * Electron の Notification に相当。
 * Electrobun の Utils.showNotification() にマッピング。
 */
export const showNotification = (options: {
  title: string;
  body: string;
}): void => {
  Utils.showNotification({
    title: options.title,
    body: options.body,
  });
};

/**
 * Electron の clipboard に相当。
 */
export const clipboard = {
  readText: async (): Promise<string> =>
    (await Utils.clipboardReadText()) ?? '',
  writeText: (text: string): void => {
    Utils.clipboardWriteText(text);
  },
};

/**
 * Electron の app.quit() に相当。
 */
export const quit = (): void => {
  Utils.quit();
};
