import { Effect } from 'effect';
import z from 'zod';

import { initializeMainSentry } from './index';
import { runEffect, runEffectExit } from './lib/effectTRPC';
import { mapToFileOperationError, toError } from './lib/errorMapping';
import { ERROR_CATEGORIES, ERROR_CODES, UserFacingError } from './lib/errors';
import { logger } from './lib/logger';
import { backgroundSettingsRouter } from './module/backgroundSettings/controller/backgroundSettingsController';
import { debugRouter } from './module/debug/debugController';
import { electronUtilRouter } from './module/electronUtil/controller/electronUtilController';
import { openElectronDialog } from './module/electronUtil/service';
import { imageGeneratorRouter } from './module/imageGenerator/imageGeneratorController';
import { getInitProgressReplay } from './module/initProgress/emitter';
import {
  INIT_PROGRESS_CHANNEL,
  type InitProgressPayload,
  InitProgressPayloadSchema,
} from './module/initProgress/schema';
import { logInfoRouter } from './module/logInfo/logInfoCointroller';
import { logSyncRouter } from './module/logSync/logSyncController';
import * as service from './module/service';
import { settingsRouter } from './module/settings/settingsController';
import { initSettingStore } from './module/settingStore';
import { updaterRouter } from './module/updater/router';
import { vrchatApiRouter } from './module/vrchatApi/vrchatApiController';
import { vrchatLogRouter } from './module/vrchatLog/vrchatLogController';
import { vrchatPhotoRouter } from './module/vrchatPhoto/vrchatPhoto.controller';
import { vrchatWorldJoinLogRouter } from './module/vrchatWorldJoinLog/vrchatWorldJoinLog.controller';
import { eventEmitter as ee, procedure, router as trpcRouter } from './trpc';

const settingStore = initSettingStore();

/**
 * EventEmitter のイベントを非同期ジェネレーターで消費するための
 * シンプルなキュー＋シグナル。
 *
 * push() でデータをキューに追加し、drain() で全アイテムを yield する。
 * キューが空の場合は次の push() まで await で待機する。
 */
function createEventQueueSignal<T>() {
  const queue: T[] = [];
  let resolve: (() => void) | null = null;

  return {
    push(item: T) {
      queue.push(item);
      resolve?.();
    },
    async *drain() {
      if (queue.length === 0) {
        await new Promise<void>((r) => {
          resolve = r;
        });
      }
      while (queue.length > 0) {
        yield queue.shift() as T;
      }
    },
  };
}

export const router = trpcRouter({
  backgroundSettings: backgroundSettingsRouter(settingStore),
  settings: settingsRouter(),
  electronUtil: electronUtilRouter(),
  imageGenerator: imageGeneratorRouter,
  vrchatPhoto: vrchatPhotoRouter(),
  vrchatLog: vrchatLogRouter(),
  vrchatWorldJoinLog: vrchatWorldJoinLogRouter(),
  logInfo: logInfoRouter(),
  logSync: logSyncRouter(),
  vrchatApi: vrchatApiRouter,
  debug: debugRouter,
  updater: updaterRouter,
  subscribeToast: procedure.subscription(async function* () {
    /**
     * メインプロセスの `toast` イベントを非同期ジェネレーターで
     * サブスクライバーへ送信する。
     * EventEmitter のイベントを Promise ベースのキューに変換し、
     * クリーンアップは for-await ループ終了時に実行される。
     */
    const signal = createEventQueueSignal<unknown>();

    function onToast(data: unknown) {
      signal.push(data);
    }

    ee.on('toast', onToast);
    // effect-lint-allow-try-catch: finally でイベントリスナーのクリーンアップが必要
    try {
      while (true) {
        yield* signal.drain();
      }
    } finally {
      ee.off('toast', onToast);
    }
  }),
  /**
   * 初期化進捗を購読する
   * zodスキーマで検証済みのデータのみを送信
   */
  subscribeInitProgress: procedure.subscription(async function* () {
    // subscription接続完了を即座に通知
    yield { stage: 'ready' as const } satisfies InitProgressPayload;

    const signal = createEventQueueSignal<InitProgressPayload>();

    function onInitProgress(data: unknown) {
      // zodで検証してから送信
      const result = InitProgressPayloadSchema.safeParse(data);
      if (result.success) {
        signal.push(result.data);
      } else {
        logger.error({
          message: 'Invalid init progress payload received',
          stack: new Error('Zod validation failed'),
          details: {
            zodError: z.treeifyError(result.error),
            receivedData: data,
          },
        });
      }
    }

    ee.on(INIT_PROGRESS_CHANNEL, onInitProgress);
    // 実行の途中で接続したクライアントにも、次のイベントを待たずに現在地と統計を渡す。
    // リスナー登録の後に取得するので、これより新しいイベントはすべてキューに入る。
    const replay = getInitProgressReplay();
    if (replay) {
      onInitProgress(replay);
    }
    // effect-lint-allow-try-catch: finally でイベントリスナーのクリーンアップが必要
    try {
      while (true) {
        yield* signal.drain();
      }
    } finally {
      ee.off(INIT_PROGRESS_CHANNEL, onInitProgress);
    }
  }),
  getVRChatLogFilesDir: procedure.query(async () => {
    // runEffectExit が Defect/Interrupt を自動で re-throw（Sentry 送信）
    const result = await runEffectExit(service.getVRChatLogFilesDir());
    if (!result.success) {
      return {
        storedPath: null,
        path: '',
        error: result.error,
      };
    }
    return {
      ...result.value,
      error: null,
    };
  }),
  openElectronLogOnExplorer: procedure.mutation(async () => {
    await runEffect(
      service
        .openElectronLogOnExplorer()
        .pipe(Effect.mapError(mapToFileOperationError)),
    );
    return true;
  }),
  openDirOnExplorer: procedure.input(z.string()).mutation(async (ctx) => {
    await runEffect(
      service
        .openDirOnExplorer(ctx.input)
        .pipe(Effect.mapError(mapToFileOperationError)),
    );
    return true;
  }),
  setVRChatLogFilesDirByDialog: procedure.mutation(async () => {
    await runEffect(
      service.setVRChatLogFilesDirByDialog().pipe(
        Effect.catchAll((e) => {
          if (e === 'canceled') {
            // キャンセルは silent（ユーザーの意図的な操作）
            return Effect.void;
          }
          // 元のエラーオブジェクトをそのまま mapToFileOperationError に渡し、
          // toUserFacing 側で `cause` として元の Error/スタックトレースを保持する
          return Effect.fail(mapToFileOperationError(e));
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
      // runEffectExit が Defect/Interrupt を自動で re-throw（Sentry 送信）
      const result = await runEffectExit(
        openElectronDialog(
          input.properties as (
            | 'openDirectory'
            | 'openFile'
            | 'multiSelections'
          )[],
        ),
      );
      if (result.success) {
        return {
          canceled: false,
          filePaths: result.value,
        };
      }
      const error = result.error;
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
        // cause は errorMapping の toError に統一。元エラーが Error ならその
        // スタックを保持し、それ以外はメッセージを保ったまま Error 化する。
        cause: toError(error),
      });
    }),
});

export type AppRouter = typeof router;
