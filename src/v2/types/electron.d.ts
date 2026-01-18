/**
 * 初期化進捗イベントのペイロード型
 *
 * Note: この型定義は以下のzodスキーマと同期する必要があります：
 * - electron/module/initProgress/schema.ts (backend)
 * - src/v2/lib/initProgress/schema.ts (frontend)
 *
 * d.tsファイルではimportができないため、手動での同期が必要です。
 * 型の変更時は上記3箇所を更新してください。
 */
interface InitProgressPayload {
  stage:
    | 'database_sync'
    | 'directory_check'
    | 'log_append'
    | 'log_load'
    | 'photo_index'
    | 'completed';
  progress: number;
  message: string;
  details?: {
    current?: number;
    total?: number;
    currentItem?: string;
  };
}

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
      receiveInitProgress: (
        callback: (data: InitProgressPayload) => void,
      ) => () => void;
    };
  }
}
export type {};
