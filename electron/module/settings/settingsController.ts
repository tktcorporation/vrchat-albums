import { Cause, Effect, Exit, Option } from 'effect';
// Electrobun 移行: electron-updater は不要。型はインラインで定義。
type UpdateCheckResult = unknown;
import { match, P } from 'ts-pattern';

import { reloadMainWindow } from '../../electronUtil';
import { runEffect } from '../../lib/effectTRPC';
import {
  ERROR_CATEGORIES,
  ERROR_CODES,
  UserFacingError,
} from '../../lib/errors';
import { logger } from '../../lib/logger';
import * as sequelizeClient from '../../lib/sequelize';
import type { OpenPathFailed } from '../electronUtil/errors';
import * as electronUtilService from '../electronUtil/service';
import { emitProgress, emitStageStart } from '../initProgress/emitter';
import { LOG_SYNC_MODE, type LogSyncMode, syncLogs } from '../logSync/service';
import { getSettingStore } from '../settingStore';
import * as vrchatWorldJoinLogService from '../vrchatWorldJoinLog/service';
import { procedure, router as trpcRouter } from './../../trpc';
import type { UpdateError } from './errors';
import * as settingService from './service';

/**
 * UpdateError → UserFacingError 変換ヘルパー（ネットワークエラーカテゴリ）
 */
const mapUpdateError = (e: UpdateError | UserFacingError): UserFacingError => {
  if (e instanceof UserFacingError) {
    return e;
  }
  return UserFacingError.withStructuredInfo({
    code: ERROR_CODES.UNKNOWN,
    category: ERROR_CATEGORIES.NETWORK_ERROR,
    message: e.message,
    userMessage: `アップデートに失敗しました: ${e.message}`,
    cause: e,
  });
};

/**
 * UpdateError → UserFacingError 変換ヘルパー（汎用カテゴリ）
 */
const mapUpdateErrorGeneric = (e: UpdateError): UserFacingError =>
  UserFacingError.withStructuredInfo({
    code: ERROR_CODES.UNKNOWN,
    category: ERROR_CATEGORIES.UNKNOWN_ERROR,
    message: e.message,
    userMessage: `アップデートに失敗しました: ${e.message}`,
    cause: e,
  });

/**
 * OpenPathFailed → UserFacingError 変換ヘルパー
 */
const mapOpenPathErrorForSettings = (e: OpenPathFailed): UserFacingError =>
  UserFacingError.withStructuredInfo({
    code: ERROR_CODES.FILE_NOT_FOUND,
    category: ERROR_CATEGORIES.FILE_NOT_FOUND,
    message: e.message,
    userMessage: `ログフォルダを開けませんでした: ${e.message}`,
    cause: e,
  });

// 初期化処理の重複実行を防ぐためのフラグ
let isInitializing = false;

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

export const settingsRouter = () =>
  trpcRouter({
    getAppVersion: procedure.query(() => {
      const version = settingService.getAppVersion();
      return version;
    }),
    forceResetDatabase: procedure.mutation(async () => {
      await sequelizeClient.syncRDBClient({
        checkRequired: false,
      });
    }),
    syncDatabase: procedure.mutation(async () => {
      await sequelizeClient.syncRDBClient();
    }),
    isDatabaseReady: procedure.query(() => {
      const appVersion = settingService.getAppVersion();
      return sequelizeClient.checkMigrationRDBClient(appVersion);
    }),
    getAppUpdateInfo: procedure.query(async () => {
      const exit = await Effect.runPromiseExit(
        settingService.getElectronUpdaterInfo(),
      );
      if (Exit.isFailure(exit)) {
        // ネットワークエラーなど。クライアントにはアップデートなしとして返す
        return { isUpdateAvailable: false, updateInfo: null };
      }
      return exit.value;
    }),
    installUpdate: procedure.mutation(() =>
      runEffect(
        settingService.installUpdate().pipe(
          Effect.map(() => {
            reloadMainWindow();
          }),
          Effect.catchTag('NoUpdateAvailable', (e) =>
            Effect.fail(
              UserFacingError.withStructuredInfo({
                code: ERROR_CODES.VALIDATION_ERROR,
                category: ERROR_CATEGORIES.VALIDATION_ERROR,
                message: e.message,
                userMessage: 'アップデートはありません。',
                cause: e,
              }),
            ),
          ),
          Effect.mapError(mapUpdateError),
        ),
      ),
    ),
    checkForUpdates: procedure.query(async () => {
      const exit = await Effect.runPromiseExit(
        settingService.getElectronUpdaterInfo(),
      );
      if (Exit.isFailure(exit)) {
        return { isUpdateAvailable: false, updateInfo: null };
      }
      return exit.value;
    }),
    installUpdatesAndReload: procedure.mutation(() =>
      runEffect(
        settingService.installUpdate().pipe(
          Effect.map(() => {
            reloadMainWindow();
          }),
          Effect.mapError(mapUpdateErrorGeneric),
        ),
      ),
    ),
    checkForUpdatesAndReturnResult: procedure.query(
      async (): Promise<{
        isUpdateAvailable: boolean;
        updateInfo: UpdateCheckResult;
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
    installUpdatesAndReloadApp: procedure.mutation(() =>
      runEffect(
        settingService.installUpdate().pipe(
          Effect.map(() => {
            reloadMainWindow();
          }),
          Effect.mapError(mapUpdateErrorGeneric),
        ),
      ),
    ),
    openApplicationLogInExploler: procedure.mutation(() => {
      const logPath = electronUtilService.getApplicationLogPath();
      logger.debug('openApplicationLogInExploler', logPath);
      return runEffect(
        electronUtilService
          .openPathInExplorer(logPath)
          .pipe(Effect.mapError(mapOpenPathErrorForSettings)),
      );
    }),
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
      // 重複実行をチェック
      // throw することで onSuccess が発火しないようにする。
      // React 18 StrictMode は useEffect を2回実行するため、
      // 成功レスポンスを返すと2回目の mutation が成功扱いになり、
      // 1回目の SETUP_REQUIRED エラーが握りつぶされる。
      if (isInitializing) {
        logger.debug(
          'Initialization already in progress, skipping duplicate request',
        );
        throw new Error('初期化処理が既に実行中です');
      }

      isInitializing = true;

      // effect-lint-allow-try-catch: tRPC mutation 内の200行超の処理全体を Effect.gen に変換するのは
      // 大規模リファクタリングが必要。finally は isInitializing フラグのリセットのみ。
      try {
        logger.info('=== Starting application data initialization ===');

        // Step 1: データベース同期
        logger.info('Step 1: Syncing database schema...');
        emitStageStart('database_sync', 'データベースを初期化しています...');
        await sequelizeClient.syncRDBClient();
        emitProgress({
          stage: 'database_sync',
          progress: 100,
          message: 'データベースの初期化が完了しました',
        });

        // Step 2: ディレクトリチェック
        logger.info('Step 2: Checking VRChat directories...');
        emitStageStart(
          'directory_check',
          'VRChatディレクトリを確認しています...',
        );

        // VRChatログディレクトリの存在確認は、ログ同期時のエラーで判定する
        // 事前チェックは省略し、ログ同期エラーで詳細なエラーを提供
        emitProgress({
          stage: 'directory_check',
          progress: 100,
          message: 'VRChatディレクトリの確認が完了しました',
        });

        // Step 3: 初回起動判定とPhotoPath変更確認
        logger.info('Step 3: Checking if this is first launch...');
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

        // Step 3.5: 初回起動時に自動起動を有効化（テスト時はスキップ）
        if (isFirstLaunch && !process.env.PLAYWRIGHT_TEST) {
          logger.info(
            'Step 3.5: Setting default auto-start enabled for first launch...',
          );
          // Electrobun 互換: getApp() 経由で自動起動設定
          // effect-lint-allow-try-catch: ランタイム環境検出パターン
          try {
            const { getApp } = require('../../lib/electronModules');
            getApp().setLoginItemSettings({
              openAtLogin: true,
              openAsHidden: true,
            });
            logger.info('Auto-start enabled by default for first launch');
          } catch (error) {
            logger.warn('Failed to set default auto-start:', error);
            // 自動起動の設定に失敗してもアプリの初期化は続行
          }
        } else if (isFirstLaunch && process.env.PLAYWRIGHT_TEST) {
          logger.info('Step 3.5: Skipping auto-start setup in Playwright test');
        }

        // Step 4: ログ同期実行
        // emitStageStart は syncLogs 内で行われる
        logger.info('Step 4: Starting log sync...');
        const logSyncExit = await Effect.runPromiseExit(syncLogs(syncMode));

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

        // 初期化完了を通知
        emitProgress({
          stage: 'completed',
          progress: 100,
          message: '初期化が完了しました',
        });

        logger.info('=== Application data initialization completed ===');
        return { success: true };
      } catch (error) {
        logger.error({
          message: 'Application data initialization failed',
          stack: match(error)
            .with(P.instanceOf(Error), (err) => err)
            .otherwise(() => undefined),
        });

        // エラーメッセージを抽出
        const errorMessage = match(error)
          .with(P.instanceOf(Error), (err) => err.message)
          .otherwise(() => 'Unknown initialization error');

        // エラーステージをemit
        emitProgress({
          stage: 'error',
          progress: 0,
          message: '初期化に失敗しました',
          details: { currentItem: errorMessage },
        });

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
      } finally {
        // 処理完了後にフラグをリセット
        isInitializing = false;
      }
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
