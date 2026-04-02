/**
 * Electron モジュールの型スタブ。
 *
 * 背景: Electrobun 移行後、electron パッケージは削除されたが、
 * 一部のモジュールが `import type ... from 'electron'` で型を参照している。
 * 完全な移行が完了するまでの間、最低限の型定義を提供する。
 *
 * 不要になれば: 全ファイルから electron の型参照を除去した後に削除可能
 */
declare module 'electron' {
  interface App {
    getPath(name: string): string;
    getName(): string;
    getVersion(): string;
    quit(): void;
    isPackaged: boolean;
    name: string;
    getLoginItemSettings(): { openAtLogin: boolean };
    setLoginItemSettings(settings: { openAtLogin: boolean }): void;
  }

  interface BrowserWindow {
    close(): void;
    focus(): void;
    minimize(): void;
    maximize(): void;
    isMinimized(): boolean;
    isMaximized(): boolean;
    unminimize(): void;
    unmaximize(): void;
    webContents: {
      send(channel: string, ...args: unknown[]): void;
    };
  }

  interface IpcMain {
    handle(channel: string, listener: (...args: unknown[]) => unknown): void;
    on(channel: string, listener: (...args: unknown[]) => void): void;
  }

  interface IpcRenderer {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    on(channel: string, listener: (...args: unknown[]) => void): void;
    send(channel: string, ...args: unknown[]): void;
  }

  interface NativeImage {
    toDataURL(): string;
    toPNG(): Buffer;
  }

  interface Dialog {
    showOpenDialog(options: Record<string, unknown>): Promise<{
      canceled: boolean;
      filePaths: string[];
    }>;
    showSaveDialog(options: Record<string, unknown>): Promise<{
      canceled: boolean;
      filePath?: string;
    }>;
  }

  interface Clipboard {
    readText(): string;
    writeText(text: string): void;
    writeImage(image: NativeImage): void;
  }

  interface Shell {
    openExternal(url: string): Promise<void>;
    openPath(path: string): Promise<string>;
    showItemInFolder(fullPath: string): void;
  }

  interface Rectangle {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  namespace Electron {
    type App = import('electron').App;
    type BrowserWindow = import('electron').BrowserWindow;
    type NativeImage = import('electron').NativeImage;
    type Clipboard = import('electron').Clipboard;
    type Rectangle = import('electron').Rectangle;
  }

  const app: App;
  const ipcMain: IpcMain;
  const ipcRenderer: IpcRenderer;
  const dialog: Dialog;
  const clipboard: Clipboard;
  const shell: Shell;
  const nativeImage: {
    createFromPath(path: string): NativeImage;
    createFromBuffer(buffer: Buffer): NativeImage;
  };
  class BrowserWindow {
    constructor(options: Record<string, unknown>);
    static getAllWindows(): BrowserWindow[];
  }

  export {
    app,
    ipcMain,
    ipcRenderer,
    dialog,
    clipboard,
    shell,
    nativeImage,
    BrowserWindow,
  };
  export type {
    App,
    IpcMain,
    IpcRenderer,
    Dialog,
    Clipboard,
    Shell,
    NativeImage,
    Rectangle,
  };
  export default Electron;
}
