import { observable } from '@trpc/server/observable';
import z from 'zod';

import { initializeMainSentry } from './index';
import {
  fileOperationErrorMappings,
  handleResultError,
  handleResultErrorWithSilent,
} from './lib/errorHelpers';
import { logger } from './lib/logger';
import { backgroundSettingsRouter } from './module/backgroundSettings/controller/backgroundSettingsController';
import { debugRouter } from './module/debug/debugController';
import { electronUtilRouter } from './module/electronUtil/controller/electronUtilController';
import { openGetFileDialog } from './module/electronUtil/service';
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
      function onToast(text: string) {
        emit.next(text);
      }

      ee.on('toast', onToast);

      return () => {
        ee.off('toast', onToast);
      };
    });
  }),
  getVRChatLogFilesDir: procedure.query(async () => {
    const logFilesDir = service.getVRChatLogFilesDir();
    return logFilesDir;
  }),
  getStatusToUseVRChatLogFilesDir: procedure.query(async () => {
    const vrchatLogFilesDir = await service.getVRChatLogFilesDir();
    let status:
      | 'ready'
      | 'logFilesDirNotSet'
      | 'logFilesNotFound'
      | 'logFileDirNotFound' = 'ready';
    if (vrchatLogFilesDir.path === null) {
      status = 'logFilesDirNotSet';
    } else if (vrchatLogFilesDir.error !== null) {
      status = vrchatLogFilesDir.error;
    }
    return status;
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
          throw new Error(`Dialog error: ${error}`);
        },
      );
    }),
});

export type AppRouter = typeof router;
