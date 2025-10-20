import * as nodeFsPromises from 'node:fs/promises';
import * as path from 'node:path';
import { type Result, ok } from 'neverthrow';
import { P, match } from 'ts-pattern';
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
 * エラーが発生した場合はfalseを返して正常に動作を継続
 */
export const isMigrationNeeded = async (): Promise<boolean> => {
  // キャッシュチェック
  if (migrationCheckCache !== null) {
    const cacheAge = Date.now() - migrationCheckCache.timestamp;
    if (cacheAge < CACHE_LIFETIME) {
      return migrationCheckCache.result;
    }
  }

  try {
    const { app } = await import('electron');
    const oldAppPath = await getOldAppUserDataPath();
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
      stack: match(error)
        .with(P.instanceOf(Error), (err) => err)
        .otherwise(() => new Error(String(error))),
    });
    const result = false;
    // エラー時もキャッシュに保存（頻繁なファイルアクセスを防ぐ）
    migrationCheckCache = {
      result,
      timestamp: Date.now(),
    };
    return result;
  }
};

/**
 * Get the path to the old app's user data directory
 * 同期的なファイルアクセスを避けて、パスのみ返す
 */
const getOldAppUserDataPath = async (): Promise<string> => {
  try {
    const { app } = await import('electron');
    const currentUserDataPath = app.getPath('userData');
    const parentDir = path.dirname(currentUserDataPath);

    // Check for different variations of the old app name
    const possibleOldAppNames = ['vrchat-photo-journey', 'VRChatPhotoJourney'];

    for (const appName of possibleOldAppNames) {
      const possiblePath = path.join(parentDir, appName);
      try {
        await nodeFsPromises.access(possiblePath);
        return possiblePath;
      } catch {
        // Continue to next possible name
      }
    }

    // Return default if none exist
    return path.join(parentDir, 'vrchat-photo-journey');
  } catch (error) {
    logger.error({
      message: 'Failed to get old app path',
      stack: match(error)
        .with(P.instanceOf(Error), (err) => err)
        .otherwise(() => new Error(String(error))),
    });
    return '';
  }
};

/**
 * Perform the migration from old app to new app
 */
export const performMigrationIfNeeded = async (): Promise<void> => {
  try {
    const needsMigration = await isMigrationNeeded();

    if (!needsMigration) {
      logger.info('Migration not needed');
      return;
    }

    logger.info('Migration needed, starting migration process...');
    const result = await performMigration();

    if (result.isErr()) {
      logger.error({
        message: 'Migration failed',
        stack: result.error,
      });
    } else {
      logger.info('Migration completed successfully');
    }
  } catch (error) {
    logger.error({
      message: 'Error during migration check',
      stack: match(error)
        .with(P.instanceOf(Error), (err) => err)
        .otherwise(() => new Error(String(error))),
    });
  }
};

/**
 * Perform the migration from old app to new app
 */
export const performMigration = async (): Promise<
  Result<MigrationResult, Error>
> => {
  const { app } = await import('electron');
  const oldAppPath = await getOldAppUserDataPath();
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
  try {
    const oldConfigPath = path.join(oldAppPath, 'config.json');
    const newConfigPath = path.join(currentAppPath, 'config.json');

    await nodeFsPromises.copyFile(oldConfigPath, newConfigPath);
    result.details.settings = true;
    logger.info('Settings migrated successfully');
  } catch (error) {
    logger.warn('Settings migration skipped:', error);
  }

  // 2. Migrate logStore using importService
  try {
    const oldLogStorePath = path.join(oldAppPath, 'logStore');

    // Check if logStore directory exists
    await nodeFsPromises.access(oldLogStorePath);

    const { importService } = await import(
      '../vrchatLog/importService/importService'
    );
    const importResult = await importService.importLogStoreFiles(
      [oldLogStorePath],
      async () => {
        // DBLogProvider is not needed for migration
        return [];
      },
    );

    if (importResult.isOk()) {
      result.details.logStore = true;
      logger.info('LogStore migrated successfully');
    } else {
      result.errors.push(
        `LogStore import failed: ${importResult.error.message}`,
      );
    }
  } catch (error) {
    logger.warn('LogStore migration skipped:', error);
  }

  // 3. Create migration marker if any migration was successful
  if (
    result.details.settings ||
    result.details.logStore ||
    result.details.database
  ) {
    try {
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

      await nodeFsPromises.writeFile(markerPath, markerContent, 'utf-8');
      result.migrated = true;
    } catch (error) {
      result.errors.push(`Failed to create migration marker: ${error}`);
    }
  }

  logger.info('Migration completed:', result);
  return ok(result);
};
