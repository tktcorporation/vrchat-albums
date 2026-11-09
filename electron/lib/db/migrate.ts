import type { DatabaseSync } from 'node:sqlite';

import { getTableName } from 'drizzle-orm';
import type { NodeSQLiteDatabase } from 'drizzle-orm/node-sqlite';
import { migrateSync } from 'drizzle-orm/sqlite-core';
import { Cause, Effect, Exit } from 'effect';
import path from 'pathe';

import { logger } from '../logger';
import { LegacyTakeoverFailed, type LegacyTakeoverError } from './errors';
import {
  backupLegacyDatabase,
  listUserTables,
  reconcileLegacySchema,
} from './legacyTakeover';
import { loadEmbeddedMigrations } from './migrations';
import { appTables } from './schema';

/** drizzle が適用済みのマイグレーションを記録するテーブル */
const DRIZZLE_MIGRATIONS_TABLE = '__drizzle_migrations';

/**
 * `migrateSync` に渡すと、SQL を実行せずに、渡したマイグレーションを適用済みとして記録だけする設定。
 * `init` は drizzle-kit の `pull --init` が使う選択肢で、型定義には出ていない。
 * `migrationsTable` を一緒に書くのは、型の上で既知の項目を持たせて引数に渡せるようにするため。
 * 記録用のテーブルに既に行があるとき、または 2 つ以上を渡したときは、記録せずに理由を返す。
 */
const RECORD_ONLY_CONFIG = {
  migrationsTable: DRIZZLE_MIGRATIONS_TABLE,
  init: true,
};

/** Sequelize の時代の DB にだけあるテーブル。引き継ぎの要否の判定に使う */
const SEQUELIZE_MIGRATIONS_TABLE = 'Migrations';

/**
 * Sequelize の時代に作られ、まだ Drizzle の管理下に無い DB か。
 * アプリのテーブルか Sequelize の `Migrations` があり、`__drizzle_migrations` が無いものを指す。
 */
const isLegacyDatabase = (tables: readonly string[]): boolean => {
  if (tables.includes(DRIZZLE_MIGRATIONS_TABLE)) {
    return false;
  }
  const knownTables = new Set<string>([
    SEQUELIZE_MIGRATIONS_TABLE,
    ...appTables.map((table) => getTableName(table)),
  ]);
  return tables.some((table) => knownTables.has(table));
};

const takeOverLegacyDatabase = (props: {
  db: NodeSQLiteDatabase;
  sqlite: DatabaseSync;
  dbPath: string;
}): Effect.Effect<void, LegacyTakeoverError> =>
  Effect.gen(function* () {
    const [baseline] = loadEmbeddedMigrations();
    if (baseline === undefined) {
      return yield* Effect.die(new Error('No embedded migrations found'));
    }
    const backupPath = yield* backupLegacyDatabase({
      sqlite: props.sqlite,
      dbPath: props.dbPath,
      backupDir: path.join(path.dirname(props.dbPath), 'backups'),
      now: new Date(),
    });
    const { applied } = yield* reconcileLegacySchema({
      sqlite: props.sqlite,
      baselineStatements: baseline.sql,
      markBaselineApplied: () => {
        const result = migrateSync(
          [baseline],
          props.db._.session,
          RECORD_ONLY_CONFIG,
        );
        if (result !== undefined) {
          throw new LegacyTakeoverFailed({
            message: `Failed to record the baseline migration: ${result.exitCode}`,
            cause: result,
          });
        }
      },
    });
    logger.info({
      message: 'Took over the database created by Sequelize',
      details: { backupPath, reconciledStatements: applied },
    });
  });

/**
 * 開いている DB に、処理本体へ埋め込んだマイグレーションのうち未適用のものを適用する。
 *
 * Sequelize の時代の DB は、先に `takeOverLegacyDatabase` で引き継ぐ。引き継げない DB は
 * 触らずに残し、エラーを記録して投げる（起動時の初期化が失敗として画面に出す）。
 *
 * マイグレーションは同期で実行され、その間は処理本体のイベントループが止まる。
 */
export const applyMigrations = async (props: {
  db: NodeSQLiteDatabase;
  sqlite: DatabaseSync;
  dbPath: string;
}): Promise<void> => {
  const migrations = loadEmbeddedMigrations();
  const program = Effect.gen(function* () {
    if (isLegacyDatabase(listUserTables(props.sqlite))) {
      yield* takeOverLegacyDatabase(props);
    }
    const startedAt = performance.now();
    migrateSync(migrations, props.db._.session);
    logger.info(
      `Database migrations applied (${migrations.length} known) in ${(performance.now() - startedAt).toFixed(0)}ms`,
    );
  });

  const exit = await Effect.runPromiseExit(program);
  if (Exit.isFailure(exit)) {
    const error = Cause.squash(exit.cause);
    logger.error({
      message: 'Database migration failed',
      stack: error instanceof Error ? error : new Error(String(error)),
    });
    throw error;
  }
};
