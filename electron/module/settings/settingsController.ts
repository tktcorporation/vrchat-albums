import { Cause, Effect, Exit, Option } from 'effect';
import type { UpdateCheckResult } from 'electron-updater';
import { match, P } from 'ts-pattern';

import { TERMS_VERSION } from '../../../src/v2/constants/terms/version';
import {
  ERROR_CATEGORIES,
  ERROR_CODES,
  UserFacingError,
} from '../../lib/errors';
import { logger } from '../../lib/logger';
import * as sequelizeClient from '../../lib/sequelize';
import { beginInitProgressRun } from '../initProgress/emitter';
import {
  LOG_SYNC_MODE,
  type LogSyncLock,
  type LogSyncMode,
  runWithLogSyncLock,
  syncLogsHoldingLock,
  toInitSyncMode,
} from '../logSync/service';
import { getSettingStore } from '../settingStore';
import * as vrchatWorldJoinLogService from '../vrchatWorldJoinLog/service';
import { procedure, router as trpcRouter } from './../../trpc';
import * as settingService from './service';

/**
 * 実行中の初期化処理。重複した呼び出しは新しく走らせず、これに合流して同じ結果を受け取る。
 *
 * 開発時の React StrictMode の二重マウントや、subscription 接続待ちのタイムアウトと接続完了が
 * 重なると、レンダラーから初期化が 2 回呼ばれることがある。2 回目に「成功」を即答すると、
 * レンダラーは DB の準備前にギャラリーを開いてしまうため、1 回目の完了まで待たせる。
 */
let inFlightInitialization: Promise<{ success: true }> | null = null;

// 前回の PhotoPath を記録しておくための変数
let lastKnownPhotoPath: string | null = null;

/**
 * PhotoPath の設定が変更されたかどうかを確認する
 * 変更されている場合は写真の再インデックスが必要
 */
const hasPhotoPathChanged = (): boolean => {
  const settingStore = getSettingStore();
  const currentPhotoPath = settingStore.getVRChatPhotoDir();

  if (lastKnownPhotoPath === null) {
    // 初回起動時は記録して変更なしとする
    lastKnownPhotoPath = currentPhotoPath;
    return false;
  }

  const hasChanged = lastKnownPhotoPath !== currentPhotoPath;
  if (hasChanged) {
    logger.info(
      `PhotoPath changed from "${lastKnownPhotoPath}" to "${currentPhotoPath}"`,
    );
    lastKnownPhotoPath = currentPhotoPath;
  }

  return hasChanged;
};

/**
 * アプリケーション起動時の初期化処理。
 * 進捗ストリームの実行を最初から最後まで、ログ同期のセマフォの permit を持ったまま進める。
 * permit の外で開始すると、初期化中に始まった単独のログ同期（バックグラウンド同期・インポート後の同期など）が
 * 初期化の実行を置き換えたり閉じたりしてしまうため。単独の同期は初期化が終わるまで待つ。
 */
const runInitialization = (): Promise<{ success: true }> =>
  runWithLogSyncLock((lock) => runInitializationHoldingLock(lock));

/**
 * 初期化処理の本体。データベース初期化、初回起動判定、ログ同期を順に実行し、進捗を init-progress へ送る。
 */
const runInitializationHoldingLock = async (
  lock: LogSyncLock,
): Promise<{ success: true }> => {
  // 起動種別は DB の準備ができるまで判定できないため、null で実行を始めて Step 2 で設定する
  const run = beginInitProgressRun('startup', null);

  // effect-lint-allow-try-catch: 200行超の処理全体を Effect.gen に変換するのは大規模リファクタリングが必要。
  // catch はエラーの分類（UserFacingError はそのまま、それ以外は cause 付きで包む）と再スローのみ。
  try {
    logger.info('=== Starting application data initialization ===');

    // Step 1: データベース同期
    // VRChat ログディレクトリの存在確認は事前に行わず、ログ同期のエラーで判定する
    logger.info('Step 1: Syncing database schema...');
    run.stage('database_sync', 0);
    await sequelizeClient.syncRDBClient();
    run.stage('database_sync', 100);

    // Step 2: 初回起動判定とPhotoPath変更確認
    logger.info('Step 2: Checking if this is first launch...');
    let isFirstLaunch = true;
    let syncMode: LogSyncMode = LOG_SYNC_MODE.FULL;

    await vrchatWorldJoinLogService
      .findVRChatWorldJoinLogList({
        orderByJoinDateTime: 'desc',
      })
      .then(
        (existingLogs) => {
          isFirstLaunch = existingLogs.length === 0;

          // PhotoPath変更の確認
          const photoPathChanged = hasPhotoPathChanged();

          // 同期モード決定: 初回起動 OR PhotoPath変更時は FULL モード
          syncMode =
            isFirstLaunch || photoPathChanged
              ? LOG_SYNC_MODE.FULL
              : LOG_SYNC_MODE.INCREMENTAL;

          logger.info(`Found ${existingLogs.length} existing logs`);
          if (photoPathChanged) {
            logger.info(
              'PhotoPath change detected, forcing FULL sync mode for photo re-indexing',
            );
          }
        },
        (error) => {
          // データベースエラー（テーブル未作成など）の場合は初回起動として扱う
          logger.info(
            'Database error detected, treating as first launch:',
            error,
          );
          isFirstLaunch = true;
          syncMode = LOG_SYNC_MODE.FULL;
        },
      );

    logger.info(
      `Detected ${
        isFirstLaunch ? 'first launch' : 'regular launch'
      }, using ${syncMode} sync mode`,
    );
    run.setLaunch({
      syncMode: toInitSyncMode(syncMode),
      isFirstLaunch,
    });
    // 差分起動では登録済みの写真の月別枚数をここで送り、ログ同期の前にグラフを埋めておく
    await run.flushStats();

    // Step 2.5: 自動起動設定の初期化・復元（テスト時はスキップ）
    // 初回起動時: 自動起動を有効化し、意図を settingStore に保存
    // アップデート後: settingStore の意図と OS 状態が不一致なら再登録
    //   （electron-updater で exe パスが変わると OS のログインアイテム登録が無効になるため）
    if (!process.env.PLAYWRIGHT_TEST) {
      const settingStore = getSettingStore();
      const savedAutoStartIntent = settingStore.getAutoStartEnabled();

      if (isFirstLaunch) {
        logger.info(
          'Step 2.5: Setting default auto-start enabled for first launch...',
        );
        await import('electron')
          .then(({ app }) => {
            app.setLoginItemSettings({
              openAtLogin: true,
            });
            settingStore.setAutoStartEnabled(true);
            logger.info(
              'Auto-start enabled by default for first launch and saved to settingStore',
            );
          })
          .catch((error) => {
            logger.warn('Failed to set default auto-start:', error);
            // 自動起動の設定に失敗してもアプリの初期化は続行
          });
      } else if (savedAutoStartIntent !== null) {
        // 通常起動: settingStore に保存された意図と OS 状態を比較
        await import('electron')
          .then(({ app }) => {
            const currentOsSetting = app.getLoginItemSettings().openAtLogin;
            if (savedAutoStartIntent && !currentOsSetting) {
              // ユーザーは有効にしていたが OS 側が無効 → アップデートでリセットされた可能性
              logger.info(
                'Step 2.5: Auto-start was enabled by user but OS reports disabled. Re-registering login item (likely due to app update changing exe path).',
              );
              app.setLoginItemSettings({
                openAtLogin: true,
              });
              logger.info('Auto-start re-registered successfully after update');
            }
          })
          .catch((error) => {
            logger.warn(
              'Failed to restore auto-start setting after update:',
              error,
            );
          });
      }
    } else if (isFirstLaunch) {
      logger.info('Step 2.5: Skipping auto-start setup in Playwright test');
    }

    // Step 3: ログ同期実行
    // log_append 以降のステージの進捗は、ログ同期がこの実行へ送る
    logger.info('Step 3: Starting log sync...');
    const logSyncExit = await Effect.runPromiseExit(
      syncLogsHoldingLock(lock, syncMode, run),
    );

    if (Exit.isFailure(logSyncExit)) {
      const failOpt = Cause.failureOption(logSyncExit.cause);
      if (Option.isSome(failOpt)) {
        const logSyncError = failOpt.value;
        // ログ同期エラーの場合、詳細なエラータイプを特定
        // Data.TaggedError は _tag、旧エラークラスは code を持つ
        const errorTag = (() => {
          if ('_tag' in logSyncError) {
            return logSyncError._tag;
          }
          if ('code' in logSyncError) {
            return (logSyncError as { code: string }).code;
          }
          return 'UNKNOWN';
        })();

        // VRChatログディレクトリが見つからない場合は、設定が必要なエラーとして処理
        const isSetupRequired = match(errorTag)
          .with('LOG_FILE_DIR_NOT_FOUND', () => true)
          .with('LOG_FILES_NOT_FOUND', () => true)
          .with('LogFileDirNotFound', () => true)
          .with('LogFilesNotFound', () => true)
          .otherwise(() => false);

        if (isSetupRequired) {
          logger.info(
            'VRChat directory setup required - throwing UserFacingError to trigger setup screen',
          );

          const setupError = UserFacingError.withStructuredInfo({
            code: ERROR_CODES.VRCHAT_DIRECTORY_SETUP_REQUIRED,
            category: ERROR_CATEGORIES.SETUP_REQUIRED,
            message: 'VRChat directory not found',
            userMessage:
              'VRChatのログディレクトリが見つかりません。初期設定が必要です。',
            details: {
              syncError: logSyncError,
            },
          });

          throw setupError;
        }

        // その他のエラーは警告として記録（Sentry で追跡）
        logger.warnWithSentry({
          message: `Log sync failed: ${
            logSyncError.message || 'Unknown error'
          }`,
          details: { errorTag },
        });
      } else {
        // Defect: re-throw して Sentry で捕捉
        const dieOpt = Cause.dieOption(logSyncExit.cause);
        if (Option.isSome(dieOpt)) {
          throw dieOpt.value;
        }
        // Interrupt やその他の未知の Cause
        throw new Error(
          'Effect was interrupted or failed with an unknown cause',
        );
      }
    } else {
      logger.info('Log sync completed successfully');
    }

    // 初期化完了を通知（最終の統計を届けてから終端イベントを送る）
    await run.flushStats();
    run.end('completed');

    logger.info('=== Application data initialization completed ===');
    return { success: true };
  } catch (error) {
    logger.error({
      message: 'Application data initialization failed',
      stack: error instanceof Error ? error : undefined,
    });

    // エラーメッセージを抽出
    const errorMessage = match(error)
      .with(P.instanceOf(Error), (err) => err.message)
      .otherwise(() => 'Unknown initialization error');

    // エラーの内容は mutation のエラーとしてレンダラーへ届くため、進捗ストリームには終端だけを送る
    run.end('error');

    // UserFacingErrorの場合は構造化情報を保持して再スロー
    if (error instanceof UserFacingError) {
      throw error;
    }

    // その他のエラーの場合は新しいUserFacingErrorでラップ（元のスタックトレースを保持）
    throw new UserFacingError(
      `初期化に失敗しました: ${errorMessage}`,
      undefined,
      { cause: error instanceof Error ? error : undefined },
    );
  }
};

export const settingsRouter = () =>
  trpcRouter({
    getAppVersion: procedure.query(() => {
      const version = settingService.getAppVersion();
      return version;
    }),
    checkForUpdatesAndReturnResult: procedure.query(
      async (): Promise<{
        isUpdateAvailable: boolean;
        updateInfo: UpdateCheckResult | null;
      }> => {
        const exit = await Effect.runPromiseExit(
          settingService.getElectronUpdaterInfo(),
        );
        if (Exit.isFailure(exit)) {
          return { isUpdateAvailable: false, updateInfo: null };
        }
        return {
          isUpdateAvailable: exit.value.isUpdateAvailable,
          updateInfo: exit.value.updateInfo,
        };
      },
    ),
    throwErrorForSentryTest: procedure.mutation(async () => {
      logger.debug('Throwing test error for Sentry integration');
      const sentryTestError = new Error(
        'This is a test error for Sentry integration.',
      );
      sentryTestError.name = 'SentryTestError';
      Object.defineProperty(sentryTestError, 'additionalInfo', {
        enumerable: true,
        value: {
          timestamp: new Date().toISOString(),
          environment: process.env.NODE_ENV,
          testProperty: 'This is a test property',
        },
      });
      throw sentryTestError;
    }),

    /**
     * アプリケーション起動時の完全な初期化処理を実行する。
     * データベース初期化、同期、ログ同期まで順次実行される。
     */
    initializeAppData: procedure.mutation(async () => {
      // 初期化は利用者のログと写真を読み、初回は OS のログイン項目も登録する。
      // 画面側の流れに不具合があっても、現在の版の規約に同意する前にこれらへ触れないようここでも拒む
      const settingStore = getSettingStore();
      if (
        !settingStore.getTermsAccepted() ||
        settingStore.getTermsVersion() !== TERMS_VERSION
      ) {
        throw new UserFacingError(
          '利用規約に同意してから読み込みを始めてください',
        );
      }
      if (inFlightInitialization) {
        logger.info(
          'Initialization already in progress, joining the running initialization',
        );
        return inFlightInitialization;
      }
      const initialization = runInitialization().finally(() => {
        inFlightInitialization = null;
      });
      inFlightInitialization = initialization;
      return initialization;
    }),

    /**
     * 旧アプリからの移行が必要かどうかをチェックする
     */
    checkMigrationStatus: procedure.query(async () => {
      return import('../migration/service')
        .then(async ({ isMigrationNeeded }) => {
          const needed = await Effect.runPromise(isMigrationNeeded());

          return {
            migrationNeeded: needed,
            oldAppName: 'vrchat-photo-journey',
            newAppName: 'VRChatAlbums',
          };
        })
        .catch((error) => {
          logger.warn('Failed to check migration status:', error);
          // エラーが発生した場合は移行不要として扱う
          return {
            migrationNeeded: false,
            oldAppName: 'vrchat-photo-journey',
            newAppName: 'VRChatAlbums',
          };
        });
    }),

    /**
     * ユーザーの承認を得て旧アプリからのデータ移行を実行する
     */
    performMigration: procedure.mutation(async () => {
      // 動的インポートで移行サービスを読み込む
      const { performMigration } = await import('../migration/service');
      const migrationResult = await Effect.runPromise(performMigration());

      // エラーは MigrationResult.errors 配列に格納される
      if (migrationResult.errors.length > 0) {
        logger.error({
          message: `Migration failed with errors: ${migrationResult.errors.join(
            ', ',
          )}`,
        });
        throw new UserFacingError(
          `データ移行に失敗しました: ${migrationResult.errors.join(', ')}`,
        );
      }
      return migrationResult;
    }),

    /**
     * 移行通知が表示されたかどうかを取得する
     */
    getMigrationNoticeShown: procedure.query(async () => {
      const settingStore = getSettingStore();
      const shown = settingStore.getMigrationNoticeShown();
      logger.debug('[Settings] getMigrationNoticeShown:', shown);
      return shown;
    }),

    /**
     * 移行通知が表示されたことを記録する
     */
    setMigrationNoticeShown: procedure.mutation(async () => {
      const settingStore = getSettingStore();
      settingStore.setMigrationNoticeShown(true);
      return { success: true };
    }),
  });
