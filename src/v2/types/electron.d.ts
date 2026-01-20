/**
 * Electron IPC型定義
 *
 * Note: 初期化進捗(initProgress)はtRPC subscriptionに移行したため、
 * ここでは定義していない。
 *
 * @see src/v2/hooks/useInitProgress.ts - tRPC subscription使用
 */

declare global {
  const __SENTRY_RELEASE__: string;

  interface Window {
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
export type {};
