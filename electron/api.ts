import { observable } from '@trpc/server/observable';
import { Cause, Effect, Exit, Option } from 'effect';
import z from 'zod';

import { initializeMainSentry } from './index';
import { runEffect } from './lib/effectTRPC';
import { ERROR_CATEGORIES, ERROR_CODES, UserFacingError } from './lib/errors';
import { logger } from './lib/logger';
import { backgroundSettingsRouter } from './module/backgroundSettings/controller/backgroundSettingsController';
import { debugRouter } from './module/debug/debugController';
import { electronUtilRouter } from './module/electronUtil/controller/electronUtilController';
import { openGetFileDialog } from './module/electronUtil/service';
import { imageGeneratorRouter } from './module/imageGenerator/imageGeneratorController';
import {
  type InitProgressPayload,
  InitProgressPayloadSchema,
} from './module/initProgress/schema';
import { logInfoRouter } from './module/logInfo/logInfoCointroller';
import { logSyncRouter } from './module/logSync/logSyncController';
import * as service from './module/service';
import { initSettingStore } from './module/settingStore';
import { settingsRouter } from './module/settings/settingsController';
import { updaterRouter } from './module/updater/router';
import { vrchatApiRouter } from './module/vrchatApi/vrchatApiController';
import { vrchatLogRouter } from './module/vrchatLog/vrchatLogController';
import { vrchatPhotoRouter } from './module/vrchatPhoto/vrchatPhoto.controller';
import { vrchatPhotoMetadataRouter } from './module/vrchatPhotoMetadata/vrchatPhotoMetadata.controller';
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
  imageGenerator: imageGeneratorRouter,
  vrchatPhoto: vrchatPhotoRouter(),
  vrchatPhotoMetadata: vrchatPhotoMetadataRouter(),
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
      // subscription接続完了を即座に通知
      emit.next({
        stage: 'ready',
        progress: 0,
        message: '接続完了',
      });

      function onInitProgress(data: unknown) {
        // zodで検証してから送信
        const result = InitProgressPayloadSchema.safeParse(data);
        if (result.success) {
          emit.next(result.data);
        } else {
          logger.error({
            message: 'Invalid init progress payload received',
            stack: new Error('Zod validation failed'),
            details: {
              zodError: result.error.format(),
              receivedData: data,
            },
          });
        }
      }

      ee.on('init-progress', onInitProgress);

      return () => {
        ee.off('init-progress', onInitProgress);
      };
    });
  }),
  getVRChatLogFilesDir: procedure.query(async () => {
    const exit = await Effect.runPromiseExit(service.getVRChatLogFilesDir());
    // tRPC レスポンス用に変換（後方互換性のため error フィールドを含める）
    if (Exit.isFailure(exit)) {
      const failOpt = Cause.failureOption(exit.cause);
      if (Option.isSome(failOpt)) {
        return {
          storedPath: null,
          path: '',
          error: failOpt.value,
        };
      }
      // 型付きエラー以外のケース（defect など）は logFileDirNotFound として扱う
      return {
        storedPath: null,
        path: '',
        error: 'logFileDirNotFound' as const,
      };
    }
    return {
      ...exit.value,
      error: null,
    };
  }),
  getStatusToUseVRChatLogFilesDir: procedure.query(async () => {
    const exit = await Effect.runPromiseExit(service.getVRChatLogFilesDir());
    if (Exit.isFailure(exit)) {
      const failOpt = Cause.failureOption(exit.cause);
      if (Option.isSome(failOpt)) {
        return failOpt.value;
      }
      // Defect（予期しないエラー）は再スローして Sentry で捕捉
      const dieOpt = Cause.dieOption(exit.cause);
      if (Option.isSome(dieOpt)) {
        throw dieOpt.value;
      }
      throw new Error('Effect was interrupted or failed with an unknown cause');
    }
    if (exit.value.path === null) {
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
      const clearEffect = service.clearStoredSetting(ctx.input);
      await runEffect(
        clearEffect.pipe(
          // SettingStoreError は silent（設定削除失敗は致命的ではない）
          Effect.catchAll(() => Effect.succeed(undefined)),
        ),
      );
      ee.emit('toast', '設定を削除しました');
      return undefined;
    }),
  openPathOnExplorer: procedure.input(z.string()).mutation(async (ctx) => {
    await runEffect(
      service.openPathOnExplorer(ctx.input).pipe(
        Effect.mapError((e) =>
          UserFacingError.withStructuredInfo({
            code: ERROR_CODES.UNKNOWN,
            category: ERROR_CATEGORIES.UNKNOWN_ERROR,
            message: String(e),
            userMessage: 'ファイル操作中にエラーが発生しました。',
            cause: e instanceof Error ? e : new Error(String(e)),
          }),
        ),
      ),
    );
    return true;
  }),
  openElectronLogOnExplorer: procedure.mutation(async () => {
    await runEffect(
      service.openElectronLogOnExplorer().pipe(
        Effect.mapError((e) =>
          UserFacingError.withStructuredInfo({
            code: ERROR_CODES.UNKNOWN,
            category: ERROR_CATEGORIES.UNKNOWN_ERROR,
            message: String(e),
            userMessage: 'ファイル操作中にエラーが発生しました。',
            cause: e instanceof Error ? e : new Error(String(e)),
          }),
        ),
      ),
    );
    return true;
  }),
  openDirOnExplorer: procedure.input(z.string()).mutation(async (ctx) => {
    await runEffect(
      service.openDirOnExplorer(ctx.input).pipe(
        Effect.mapError((e) =>
          UserFacingError.withStructuredInfo({
            code: ERROR_CODES.UNKNOWN,
            category: ERROR_CATEGORIES.UNKNOWN_ERROR,
            message: String(e),
            userMessage: 'ファイル操作中にエラーが発生しました。',
            cause: e instanceof Error ? e : new Error(String(e)),
          }),
        ),
      ),
    );
    return true;
  }),
  setVRChatLogFilesDirByDialog: procedure.mutation(async () => {
    await runEffect(
      service.setVRChatLogFilesDirByDialog().pipe(
        Effect.catchAll((e) => {
          if (e === 'canceled') {
            // キャンセルは silent（ユーザーの意図的な操作）
            return Effect.succeed(undefined);
          }
          return Effect.fail(
            UserFacingError.withStructuredInfo({
              code: ERROR_CODES.UNKNOWN,
              category: ERROR_CATEGORIES.UNKNOWN_ERROR,
              message: String(e),
              userMessage: 'ファイル操作中にエラーが発生しました。',
              cause: e instanceof Error ? e : new Error(String(e)),
            }),
          );
        }),
      ),
    );
    ee.emit('toast', 'VRChatのログファイルの保存先を設定しました');
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
      const exit = await Effect.runPromiseExit(
        openGetFileDialog(
          input.properties as Array<
            'openDirectory' | 'openFile' | 'multiSelections'
          >,
        ),
      );
      if (Exit.isSuccess(exit)) {
        return {
          canceled: false,
          filePaths: exit.value,
        };
      }
      const failOpt = Cause.failureOption(exit.cause);
      if (Option.isSome(failOpt)) {
        const error = failOpt.value;
        if (error._tag === 'OperationCanceled') {
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
      }
      // Defect
      const dieOpt = Cause.dieOption(exit.cause);
      if (Option.isSome(dieOpt)) {
        throw dieOpt.value;
      }
      throw new Error('Effect was interrupted or failed with an unknown cause');
    }),
});

export type AppRouter = typeof router;
