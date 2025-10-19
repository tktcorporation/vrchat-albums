import type { UpdateCheckResult } from 'electron-updater';
import { P, match } from 'ts-pattern';
import { reloadMainWindow } from '../../electronUtil';
import {
  ERROR_CATEGORIES,
  ERROR_CODES,
  UserFacingError,
} from '../../lib/errors';
import { logger } from '../../lib/logger';
import * as sequelizeClient from '../../lib/sequelize';
import * as electronUtilService from '../electronUtil/service';
import { LOG_SYNC_MODE, type LogSyncMode, syncLogs } from '../logSync/service';
import { getSettingStore } from '../settingStore';
import * as vrchatWorldJoinLogService from '../vrchatWorldJoinLog/service';
import { procedure, router as trpcRouter } from './../../trpc';
import * as settingService from './service';

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
      return await settingService.getElectronUpdaterInfo();
    }),
    installUpdate: procedure.mutation(async () => {
      const updateInfo = await settingService.getElectronUpdaterInfo();
      if (!updateInfo.isUpdateAvailable) {
        throw new UserFacingError('アップデートはありません。');
      }
      await settingService.installUpdate();
      reloadMainWindow();
    }),
    checkForUpdates: procedure.query(async () => {
      return await settingService.getElectronUpdaterInfo();
    }),
    installUpdatesAndReload: procedure.mutation(async () => {
      await settingService.installUpdate();
      reloadMainWindow();
    }),
    checkForUpdatesAndReturnResult: procedure.query(
      async (): Promise<{
        isUpdateAvailable: boolean;
        updateInfo: UpdateCheckResult | null;
      }> => {
        const updateInfo = await settingService.getElectronUpdaterInfo();
        return {
          isUpdateAvailable: updateInfo.isUpdateAvailable,
          updateInfo: updateInfo.updateInfo,
        };
      },
    ),
    installUpdatesAndReloadApp: procedure.mutation(async () => {
      await settingService.installUpdate();
      reloadMainWindow();
    }),
    openApplicationLogInExploler: procedure.mutation(async () => {
      const logPath = electronUtilService.getApplicationLogPath();
      logger.debug('openApplicationLogInExploler', logPath);
      await electronUtilService.openPathInExplorer(logPath);
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
      if (isInitializing) {
        logger.debug(
          'Initialization already in progress, skipping duplicate request',
        );
        // Sentryに送信しないよう、debugレベルでログ記録
        return { success: false, message: '初期化処理が既に実行中です' };
      }

      isInitializing = true;

      try {
        logger.info('=== Starting application data initialization ===');

        // Step 1: データベース同期
        logger.info('Step 1: Syncing database schema...');
        await sequelizeClient.syncRDBClient();

        // Step 2: ディレクトリチェック
        logger.info('Step 2: Checking VRChat directories...');

        // VRChatログディレクトリの存在確認は、ログ同期時のエラーで判定する
        // 事前チェックは省略し、ログ同期エラーで詳細なエラーを提供

        // Step 3: 初回起動判定とPhotoPath変更確認
        logger.info('Step 3: Checking if this is first launch...');
        let isFirstLaunch = true;
        let syncMode: LogSyncMode = LOG_SYNC_MODE.FULL;

        try {
          const existingLogs =
            await vrchatWorldJoinLogService.findVRChatWorldJoinLogList({
              orderByJoinDateTime: 'desc',
            });
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
        } catch (error) {
          // データベースエラー（テーブル未作成など）の場合は初回起動として扱う
          logger.info(
            'Database error detected, treating as first launch:',
            error,
          );
          isFirstLaunch = true;
          syncMode = LOG_SYNC_MODE.FULL;
        }

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
          try {
            const { app } = await import('electron');
            app.setLoginItemSettings({
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
        logger.info('Step 4: Starting log sync...');
        const logSyncResult = await syncLogs(syncMode);

        if (logSyncResult.isErr()) {
          // ログ同期エラーの場合、詳細なエラータイプを特定
          const errorCode = logSyncResult.error.code;

          // VRChatログディレクトリが見つからない場合は、設定が必要なエラーとして処理
          const isSetupRequired = match(errorCode)
            .with('LOG_FILE_DIR_NOT_FOUND', () => true)
            .with('LOG_FILES_NOT_FOUND', () => true)
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
                syncError: logSyncResult.error,
              },
            });

            throw setupError;
          }

          // その他のエラーは警告として記録（開発環境での一時的なエラーなど）
          logger.warn(
            `Log sync failed: ${
              logSyncResult.error.message || 'Unknown error'
            }. This is normal in development environments without VRChat logs.`,
          );
        } else {
          logger.info('Log sync completed successfully');
        }

        logger.info('=== Application data initialization completed ===');
        return { success: true };
      } catch (error) {
        logger.error({
          message: 'Application data initialization failed',
          stack: match(error)
            .with(P.instanceOf(Error), (err) => err)
            .otherwise(() => undefined),
        });

        // UserFacingErrorの場合は構造化情報を保持して再スロー
        if (error instanceof UserFacingError) {
          throw error;
        }

        // その他のエラーの場合は新しいUserFacingErrorでラップ
        const errorMessage = match(error)
          .with(P.instanceOf(Error), (err) => err.message)
          .otherwise(() => 'Unknown initialization error');
        throw new UserFacingError(`初期化に失敗しました: ${errorMessage}`);
      } finally {
        // 処理完了後にフラグをリセット
        isInitializing = false;
      }
    }),

    /**
     * 旧アプリからの移行が必要かどうかをチェックする
     */
    checkMigrationStatus: procedure.query(async () => {
      try {
        // 動的インポートで移行サービスを読み込む
        const { isMigrationNeeded } = await import('../migration/service');
        const needed = await isMigrationNeeded();

        return {
          migrationNeeded: needed,
          oldAppName: 'vrchat-photo-journey',
          newAppName: 'VRChatAlbums',
        };
      } catch (error) {
        logger.warn('Failed to check migration status:', error);
        // エラーが発生した場合は移行不要として扱う
        return {
          migrationNeeded: false,
          oldAppName: 'vrchat-photo-journey',
          newAppName: 'VRChatAlbums',
        };
      }
    }),

    /**
     * ユーザーの承認を得て旧アプリからのデータ移行を実行する
     */
    performMigration: procedure.mutation(async () => {
      try {
        // 動的インポートで移行サービスを読み込む
        const { performMigration } = await import('../migration/service');
        const result = await performMigration();

        // performMigration は Result<MigrationResult, never> を返すため、
        // エラーは発生しないが、match()で型安全に値を取り出す
        return result.match(
          (migrationResult) => {
            // エラーは MigrationResult.errors 配列に格納される
            if (migrationResult.errors.length > 0) {
              logger.error({
                message: `Migration failed with errors: ${migrationResult.errors.join(
                  ', ',
                )}`,
              });
              throw new UserFacingError(
                `データ移行に失敗しました: ${migrationResult.errors.join(
                  ', ',
                )}`,
              );
            }
            return migrationResult;
          },
          () => {
            // never型のため、ここには到達しない
            throw new Error(
              'Unreachable: performMigration should never return an error',
            );
          },
        );
      } catch (error) {
        logger.error({
          message: `Failed to perform migration: ${match(error)
            .with(P.instanceOf(Error), (err) => err.message)
            .otherwise(() => 'Unknown error')}`,
          stack: match(error)
            .with(P.instanceOf(Error), (err) => err)
            .otherwise(() => undefined),
        });

        // UserFacingErrorの場合はそのまま再スロー
        if (error instanceof UserFacingError) {
          throw error;
        }

        // その他のエラーの場合
        throw new UserFacingError(
          'データ移行中に予期しないエラーが発生しました',
        );
      }
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
