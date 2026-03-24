import * as nodeFsPromises from 'node:fs/promises';
import * as path from 'node:path';

import { Cause, Effect, Exit, Option } from 'effect';

import { logger } from '../../lib/logger';

export interface MigrationResult {
  migrated: boolean;
  details: {
    database: boolean;
    logStore: boolean;
    settings: boolean;
  };
  errors: string[];
}

// キャッシュで高速化
interface MigrationCheckCache {
  result: boolean;
  timestamp: number;
}
let migrationCheckCache: MigrationCheckCache | null = null;
const CACHE_LIFETIME = 5 * 60 * 1000; // 5分

/**
 * Clear migration cache (for testing)
 */
export const clearMigrationCache = (): void => {
  migrationCheckCache = null;
};

/**
 * Check if migration is needed
 * エラーが発生した場合はfalseを返して正常に動作を継続（エラーはログに記録）
 * Result型で返すが、エラーは常にログ記録後にfalseとして成功扱い
 */
export const isMigrationNeeded = (): Effect.Effect<boolean> => {
  return Effect.tryPromise({
    try: async (): Promise<boolean> => {
      // キャッシュチェック
      if (migrationCheckCache !== null) {
        const cacheAge = Date.now() - migrationCheckCache.timestamp;
        if (cacheAge < CACHE_LIFETIME) {
          return migrationCheckCache.result;
        }
      }

      // effect-lint-allow-try-catch: Electron 環境検出パターン
      try {
        const { app } = await import('electron');
        const oldAppPathResult = await Effect.runPromise(
          getOldAppUserDataPath(),
        );
        const oldAppPath = oldAppPathResult;
        const currentAppPath = app.getPath('userData');

        logger.debug('[Migration] Checking migration status:', {
          oldAppPath,
          currentAppPath,
        });

        // Check if old app directory exists
        const oldAppExists = await nodeFsPromises
          .access(oldAppPath)
          .then(() => true)
          .catch(() => false);

        if (!oldAppExists) {
          logger.debug('No old app data found, migration not needed');
          const result = false;
          // キャッシュに保存
          migrationCheckCache = {
            result,
            timestamp: Date.now(),
          };
          return result;
        }

        // Check if migration marker exists (to prevent re-migration)
        const migrationMarkerPath = path.join(
          currentAppPath,
          '.migration-completed',
        );
        const markerExists = await nodeFsPromises
          .access(migrationMarkerPath)
          .then(() => true)
          .catch(() => false);

        if (markerExists) {
          logger.debug('Migration already completed, skipping');
          const result = false;
          // キャッシュに保存
          migrationCheckCache = {
            result,
            timestamp: Date.now(),
          };
          return result;
        }

        logger.info('Migration needed from old app directory');
        const result = true;
        // キャッシュに保存
        migrationCheckCache = {
          result,
          timestamp: Date.now(),
        };
        return result;
      } catch (error) {
        logger.error({
          message: 'Error checking migration status',
          stack: error instanceof Error ? error : new Error(String(error)),
        });
        const result = false;
        // エラー時もキャッシュに保存（頻繁なファイルアクセスを防ぐ）
        migrationCheckCache = {
          result,
          timestamp: Date.now(),
        };
        return result;
      }
    },
    catch: () => {
      // This should never happen since the inner try-catch handles all errors
      return undefined as never;
    },
  });
};

/**
 * Get the path to the old app's user data directory
 * 同期的なファイルアクセスを避けて、パスのみ返す
 * エラー時はデフォルトパスを返す（エラーはログに記録）
 */
const getOldAppUserDataPath = (): Effect.Effect<string> => {
  return Effect.tryPromise({
    try: async (): Promise<string> => {
      // effect-lint-allow-try-catch: Electron 環境検出パターン（動的 import('electron') の失敗をキャッチ）
      try {
        const { app } = await import('electron');
        return app.getPath('userData');
      } catch (error) {
        logger.error({
          message: 'Failed to get old app path',
          stack: error instanceof Error ? error : new Error(String(error)),
        });
        return '';
      }
    },
    catch: () => undefined as never,
  }).pipe(
    Effect.flatMap((currentUserDataPath) => {
      if (currentUserDataPath === '') {
        return Effect.succeed('');
      }
      const parentDir = path.dirname(currentUserDataPath);
      const possibleOldAppNames = [
        'vrchat-photo-journey',
        'VRChatPhotoJourney',
      ];
      return Effect.tryPromise({
        try: async () => {
          for (const appName of possibleOldAppNames) {
            const possiblePath = path.join(parentDir, appName);
            const accessible = await nodeFsPromises
              .access(possiblePath)
              .then(() => true)
              .catch(() => false);
            if (accessible) {
              return possiblePath;
            }
          }
          // Return default if none exist
          return path.join(parentDir, 'vrchat-photo-journey');
        },
        catch: () => undefined as never,
      });
    }),
  );
};

/**
 * Perform the migration from old app to new app
 * エラー時もログ記録後に正常終了（起動を妨げない）
 */
export const performMigrationIfNeeded = (): Effect.Effect<void> => {
  return isMigrationNeeded().pipe(
    Effect.flatMap((needsMigration) => {
      if (!needsMigration) {
        logger.info('Migration not needed');
        return Effect.void;
      }
      logger.info('Migration needed, starting migration process...');
      return performMigration().pipe(
        Effect.tap((result) =>
          Effect.sync(() =>
            logger.info('Migration completed successfully', result),
          ),
        ),
        Effect.asVoid,
      );
    }),
    Effect.catchAllDefect((defect) => {
      logger.error({
        message: 'Error during migration check',
        stack: defect instanceof Error ? defect : new Error(String(defect)),
      });
      return Effect.void;
    }),
  );
};

/**
 * Perform the migration from old app to new app
 * Note: All errors are captured in result.errors array, function never throws
 */
export const performMigration = (): Effect.Effect<MigrationResult> => {
  return Effect.tryPromise({
    try: async () => {
      const { app } = await import('electron');
      const oldAppPath = await Effect.runPromise(getOldAppUserDataPath());
      const currentAppPath = app.getPath('userData');

      logger.info('Starting migration process...');
      logger.info(`Old app path: ${oldAppPath}`);
      logger.info(`Current app path: ${currentAppPath}`);

      const result: MigrationResult = {
        migrated: false,
        details: {
          database: false,
          logStore: false,
          settings: false,
        },
        errors: [],
      };

      // 1. Migrate settings (config.json)
      const oldConfigPath = path.join(oldAppPath, 'config.json');
      const newConfigPath = path.join(currentAppPath, 'config.json');

      await nodeFsPromises.copyFile(oldConfigPath, newConfigPath).then(
        () => {
          result.details.settings = true;
          logger.info('Settings migrated successfully');
        },
        (error) => {
          logger.warn('Settings migration skipped:', error);
        },
      );

      // 2. Migrate logStore using importService
      const oldLogStorePath = path.join(oldAppPath, 'logStore');

      // Check if logStore directory exists, then migrate
      await nodeFsPromises.access(oldLogStorePath).then(
        async () => {
          const { importService } =
            await import('../vrchatLog/importService/importService');
          const importExit = await Effect.runPromiseExit(
            importService.importLogStoreFiles([oldLogStorePath], async () => {
              // DBLogProvider is not needed for migration
              return [];
            }),
          );
          if (Exit.isSuccess(importExit)) {
            result.details.logStore = true;
            logger.info('LogStore migrated successfully');
          } else {
            const failOpt = Cause.failureOption(importExit.cause);
            if (Option.isSome(failOpt)) {
              const importError = failOpt.value;
              result.errors.push(`LogStore import failed: ${importError._tag}`);
            } else {
              // Unexpected error (defect)
              const dieOpt = Cause.dieOption(importExit.cause);
              const errorMsg = (() => {
                if (!Option.isSome(dieOpt)) {
                  return 'Unknown error';
                }
                return dieOpt.value instanceof Error
                  ? dieOpt.value.message
                  : String(dieOpt.value);
              })();
              result.errors.push(`LogStore import failed: ${errorMsg}`);
            }
          }
        },
        (error) => {
          logger.warn('LogStore migration skipped:', error);
        },
      );

      // 3. Create migration marker if any migration was successful
      if (
        result.details.settings ||
        result.details.logStore ||
        result.details.database
      ) {
        const markerPath = path.join(currentAppPath, '.migration-completed');
        const markerContent = JSON.stringify(
          {
            timestamp: new Date().toISOString(),
            fromApp: 'vrchat-photo-journey',
            toApp: 'VRChatAlbums',
            result: result,
          },
          null,
          2,
        );

        await nodeFsPromises.writeFile(markerPath, markerContent, 'utf8').then(
          () => {
            result.migrated = true;
          },
          (error) => {
            result.errors.push(`Failed to create migration marker: ${error}`);
          },
        );
      }

      logger.info('Migration completed:', result);
      return result;
    },
    catch: () => {
      // This should never happen since the inner try-catch handles all errors
      return undefined as never;
    },
  });
};
