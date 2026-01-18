/**
 * Electron IPC型定義
 *
 * Note: InitProgressPayloadなどの複雑な型は `unknown` として受け取り、
 * 使用箇所でzodスキーマによる検証を行う設計。
 * これにより、zodスキーマとd.tsの手動同期が不要になる。
 *
 * @see src/v2/lib/initProgress/schema.ts - zod検証用スキーマ
 * @see src/v2/hooks/useInitProgress.ts - 検証実装
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
      /**
       * 初期化進捗を受信する
       * @param callback データはunknownとして受け取り、useInitProgress内でzod検証する
       */
      receiveInitProgress: (callback: (data: unknown) => void) => () => void;
    };
  }
}
export type {};
