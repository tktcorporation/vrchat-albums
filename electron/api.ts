import { observable } from '@trpc/server/observable';
import z from 'zod';

import { initializeMainSentry } from './index';
import {
  fileOperationErrorMappings,
  handleResultError,
  handleResultErrorWithSilent,
} from './lib/errorHelpers';
import { ERROR_CATEGORIES, ERROR_CODES, UserFacingError } from './lib/errors';
import { logger } from './lib/logger';
import { backgroundSettingsRouter } from './module/backgroundSettings/controller/backgroundSettingsController';
import { debugRouter } from './module/debug/debugController';
import { electronUtilRouter } from './module/electronUtil/controller/electronUtilController';
import { openGetFileDialog } from './module/electronUtil/service';
import {
  type InitProgressPayload,
  InitProgressPayloadSchema,
} from './module/initProgress/types';
import { logInfoRouter } from './module/logInfo/logInfoCointroller';
import { logSyncRouter } from './module/logSync/logSyncController';
import * as service from './module/service';
import { initSettingStore } from './module/settingStore';
import { settingsRouter } from './module/settings/settingsController';
import { updaterRouter } from './module/updater/router';
import { vrchatApiRouter } from './module/vrchatApi/vrchatApiController';
import { vrchatLogRouter } from './module/vrchatLog/vrchatLogController';
import { vrchatPhotoRouter } from './module/vrchatPhoto/vrchatPhoto.controller';
import { vrchatWorldJoinLogRouter } from './module/vrchatWorldJoinLog/vrchatWorldJoinLog.controller';
import { eventEmitter as ee, procedure, router as trpcRouter } from './trpc';

// type ExtractDataTypeFromResult<R> = R extends Result<infer T, unknown>
//   ? T
//   : never;

const settingStore = initSettingStore();

export const router = trpcRouter({
  backgroundSettings: backgroundSettingsRouter(settingStore),
  settings: settingsRouter(),
  electronUtil: electronUtilRouter(),
  vrchatPhoto: vrchatPhotoRouter(),
  vrchatLog: vrchatLogRouter(),
  vrchatWorldJoinLog: vrchatWorldJoinLogRouter(),
  logInfo: logInfoRouter(),
  logSync: logSyncRouter(),
  vrchatApi: vrchatApiRouter,
  debug: debugRouter,
  updater: updaterRouter,
  subscribeToast: procedure.subscription(() => {
    return observable((emit) => {
      /**
       * メインプロセスの `toast` イベントを受け取り
       * サブスクライバーへ送信する内部関数。
       * subscribeToast の Observable 内でのみ使用される。
       */
      function onToast(data: unknown) {
        emit.next(data);
      }

      ee.on('toast', onToast);

      return () => {
        ee.off('toast', onToast);
      };
    });
  }),
  /**
   * 初期化進捗を購読する
   * zodスキーマで検証済みのデータのみを送信
   */
  subscribeInitProgress: procedure.subscription(() => {
    return observable<InitProgressPayload>((emit) => {
      function onInitProgress(data: unknown) {
        // zodで検証してから送信
        const result = InitProgressPayloadSchema.safeParse(data);
        if (result.success) {
          emit.next(result.data);
        } else {
          logger.warn('Invalid init progress payload:', result.error.message);
        }
      }

      ee.on('init-progress', onInitProgress);

      return () => {
        ee.off('init-progress', onInitProgress);
      };
    });
  }),
  getVRChatLogFilesDir: procedure.query(async () => {
    const logFilesDirResult = await service.getVRChatLogFilesDir();
    // tRPC レスポンス用に変換（後方互換性のため error フィールドを含める）
    if (logFilesDirResult.isErr()) {
      return {
        storedPath: null,
        path: '',
        error: logFilesDirResult.error,
      };
    }
    return {
      ...logFilesDirResult.value,
      error: null,
    };
  }),
  getStatusToUseVRChatLogFilesDir: procedure.query(async () => {
    const vrchatLogFilesDirResult = await service.getVRChatLogFilesDir();
    if (vrchatLogFilesDirResult.isErr()) {
      return vrchatLogFilesDirResult.error;
    }
    if (vrchatLogFilesDirResult.value.path === null) {
      return 'logFilesDirNotSet';
    }
    return 'ready';
  }),
  clearAllStoredSettings: procedure.mutation(async () => {
    service.clearAllStoredSettings();
    ee.emit('toast', '設定をすべて削除しました');
    return undefined;
  }),
  clearStoredSetting: procedure
    .input(z.union([z.literal('logFilesDir'), z.literal('vrchatPhotoDir')]))
    .mutation(async (ctx) => {
      const result = service.clearStoredSetting(ctx.input);
      // clearStoredSettingのエラーはサイレントに処理（ログのみ出力）
      const clearResult = handleResultErrorWithSilent(result, ['Error']);
      if (clearResult !== null || result.isOk()) {
        ee.emit('toast', '設定を削除しました');
      }
      return undefined;
    }),
  openPathOnExplorer: procedure.input(z.string()).mutation(async (ctx) => {
    const result = await service.openPathOnExplorer(ctx.input);
    handleResultError(result, fileOperationErrorMappings);
    return true;
  }),
  openElectronLogOnExplorer: procedure.mutation(async () => {
    const result = await service.openElectronLogOnExplorer();
    handleResultError(result, fileOperationErrorMappings);
    return true;
  }),
  openDirOnExplorer: procedure.input(z.string()).mutation(async (ctx) => {
    const result = await service.openDirOnExplorer(ctx.input);
    handleResultError(result, fileOperationErrorMappings);
    return true;
  }),
  setVRChatLogFilesDirByDialog: procedure.mutation(async () => {
    const result = await service.setVRChatLogFilesDirByDialog();
    // キャンセルはサイレントに処理、その他のエラーはUserFacingErrorに変換
    const dialogResult = handleResultErrorWithSilent(
      result,
      ['canceled'],
      fileOperationErrorMappings,
    );
    if (dialogResult !== null) {
      ee.emit('toast', 'VRChatのログファイルの保存先を設定しました');
    }
    return true;
  }),
  setVRChatLogFilePath: procedure
    .input(z.string().min(1, 'パスを入力してください'))
    .mutation(async ({ input: logFilePath }) => {
      service.setVRChatLogFilesDir(logFilePath);
      ee.emit('toast', 'VRChatのログファイルの保存先を更新しました');
      return true;
    }),
  getTermsAccepted: procedure.query(() => {
    return {
      accepted: settingStore.getTermsAccepted(),
      version: settingStore.getTermsVersion(),
    };
  }),
  setTermsAccepted: procedure
    .input(
      z.object({
        accepted: z.boolean(),
        version: z.string(),
      }),
    )
    .mutation(({ input }) => {
      settingStore.setTermsAccepted(input.accepted);
      settingStore.setTermsVersion(input.version);
      if (input.accepted) {
        initializeMainSentry();
      }
    }),
  initializeSentry: procedure.mutation(() => {
    // メインプロセスのSentryはelectron/index.tsで早期に初期化されるため、
    // ここでは追加の初期化処理は不要。
    // レンダラープロセスがSentryを使う準備ができたことをログで記録する程度に留める。
    const hasAcceptedTerms = settingStore.getTermsAccepted();
    logger.info('initializeSentry', hasAcceptedTerms);
  }),
  getVRChatPhotoExtraDirList: procedure.query((): string[] => {
    const extraDirs = settingStore.getVRChatPhotoExtraDirList();
    return extraDirs.map((dir) => dir.value);
  }),
  setVRChatPhotoExtraDirList: procedure
    .input(z.array(z.string()))
    .mutation(({ input }) => {
      settingStore.setVRChatPhotoExtraDirList(input);
      return true;
    }),
  showOpenDialog: procedure
    .input(
      z.object({
        properties: z.array(z.string()),
      }),
    )
    .mutation(async ({ input }) => {
      const result = await openGetFileDialog(
        input.properties as Array<
          'openDirectory' | 'openFile' | 'multiSelections'
        >,
      );
      return result.match(
        (filePaths) => ({
          canceled: false,
          filePaths,
        }),
        (error) => {
          if (error === 'canceled') {
            return {
              canceled: true,
              filePaths: [],
            };
          }
          // canceledでない場合は予期しないエラーとして扱う
          throw UserFacingError.withStructuredInfo({
            code: ERROR_CODES.UNKNOWN,
            category: ERROR_CATEGORIES.UNKNOWN_ERROR,
            message: 'File dialog error',
            userMessage: 'ファイル選択ダイアログでエラーが発生しました。',
            cause: new Error(String(error)),
          });
        },
      );
    }),
});

export type AppRouter = typeof router;
