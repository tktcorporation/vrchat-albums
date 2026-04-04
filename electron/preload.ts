/**
 * プリロードスクリプト（Electrobun 互換版）。
 *
 * 背景: Electron では contextBridge + ipcRenderer で IPC を設定していた。
 * Electrobun では src/main-ui/index.ts が同等の役割を果たす。
 * このファイルは後方互換性のために残すが、Electrobun ビルドでは使用されない。
 *
 * Electrobun の代替: src/main-ui/index.ts
 */

// このファイルをモジュールとして扱うための空エクスポート
export type PreloadModule = Record<string, never>;

// Electrobun 環境ではこのファイルは不要
// Electron フォールバック用として型定義のみ維持
declare global {
  interface Window {
    Main?: {
      sendErrorMessage: (message: string) => void;
      Minimize: () => void;
      Maximize: () => void;
      Close: () => void;
      on: (channel: string, callback: (data: unknown) => void) => void;
      removeAllListeners: (channel: string) => void;
    };
    MyOn?: {
      receiveStatusToUseVRChatLogFilesDir: (
        callback: (
          data:
            | 'ready'
            | 'logFilesDirNotSet'
            | 'logFilesNotFound'
            | 'logFileDirNotFound',
        ) => void,
      ) => () => void;
      receiveVRChatPhotoDirWithError: (
        callback: (data: {
          storedPath: string | null;
          path: string;
          error: null | 'photoYearMonthDirsNotFound' | 'photoDirReadError';
        }) => void,
      ) => () => void;
    };
  }
}
