import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

import { drizzle } from 'drizzle-orm/node-sqlite';
import path from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readTableDefinitions, type TableDefinition } from './legacyTakeover';
import { applyMigrations } from './migrate';
import { vrchatPhotoPaths } from './schema';

/** アプリのバージョン 0.31.6 が作った DB（行を含む）。既存の DB の基準 */
const SEQUELIZE_FIXTURE = readFileSync(
  path.join(import.meta.dirname, '__fixtures__', 'sequelize-v0.31.6.sql'),
  'utf8',
);

let workDir: string;
let openDatabases: DatabaseSync[];

beforeEach(() => {
  workDir = mkdtempSync(path.join(tmpdir(), 'vrchat-albums-migrate-'));
  openDatabases = [];
});

afterEach(() => {
  for (const sqlite of openDatabases) {
    if (sqlite.isOpen) {
      sqlite.close();
    }
  }
  rmSync(workDir, { recursive: true, force: true });
});

const openFileDatabase = (setupSql?: string) => {
  const dbPath = path.join(workDir, 'db.sqlite');
  const sqlite = new DatabaseSync(dbPath);
  openDatabases.push(sqlite);
  sqlite.exec('PRAGMA journal_mode=WAL');
  if (setupSql !== undefined) {
    sqlite.exec(setupSql);
  }
  return { sqlite, db: drizzle({ client: sqlite }), dbPath };
};

const migrate = (target: ReturnType<typeof openFileDatabase>) =>
  applyMigrations(target);

/** 型名の大文字小文字のように、SQLite の扱いが変わらない書き方の違いを揃えて比べる */
const normalize = (tables: TableDefinition[]) =>
  tables
    .filter((table) => table.name !== '__drizzle_migrations')
    .map((table) => ({
      name: table.name,
      columns: table.columns.map((column) => ({
        ...column,
        type: column.type.toUpperCase(),
      })),
      indexes: table.indexes
        .map(({ name, unique, columns }) => ({ name, unique, columns }))
        .toSorted((a, b) => a.name.localeCompare(b.name)),
    }))
    .toSorted((a, b) => a.name.localeCompare(b.name));

const sqliteMaster = (sqlite: DatabaseSync) =>
  sqlite
    .prepare('SELECT type, name, sql FROM sqlite_master ORDER BY type, name')
    .all();

const appliedMigrationNames = (sqlite: DatabaseSync) =>
  sqlite
    .prepare('SELECT name FROM __drizzle_migrations ORDER BY id')
    .all()
    .map((row) => row.name);

const backups = () => {
  const dir = path.join(workDir, 'backups');
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
};

describe('applyMigrations', () => {
  it('空の DB に、Sequelize が作っていたものと同じテーブル定義を作る', async () => {
    const fresh = openFileDatabase();
    await migrate(fresh);

    const legacy = new DatabaseSync(':memory:');
    openDatabases.push(legacy);
    legacy.exec(SEQUELIZE_FIXTURE);

    expect(normalize(readTableDefinitions(fresh.sqlite))).toEqual(
      normalize(readTableDefinitions(legacy)).filter(
        // Sequelize の記録用テーブルはアプリのテーブルではないので作らない
        (table) => table.name !== 'Migrations',
      ),
    );
    expect(appliedMigrationNames(fresh.sqlite)).toHaveLength(1);
  });

  it('Sequelize が作った DB を複製してから、定義を変えずに引き継ぐ', async () => {
    const target = openFileDatabase(SEQUELIZE_FIXTURE);
    const before = sqliteMaster(target.sqlite);

    await migrate(target);

    // 定義は __drizzle_migrations が増えただけで、Sequelize の Migrations も残る
    const after = sqliteMaster(target.sqlite).filter(
      (row) => row.name !== '__drizzle_migrations',
    );
    expect(after).toEqual(before);
    expect(appliedMigrationNames(target.sqlite)).toHaveLength(1);

    // 行はそのまま読め、日時は Date に戻る
    const photos = target.db.select().from(vrchatPhotoPaths).all();
    expect(photos).toHaveLength(1);
    expect(photos[0]?.photoTakenAt.toISOString()).toBe(
      '2024-01-31T23:30:15.123Z',
    );

    // 複製には引き継ぐ前の行がある
    const [backupName] = backups();
    expect(backupName).toMatch(/^db-before-drizzle-\d{8}T\d{6}\.sqlite$/);
    const backup = new DatabaseSync(path.join(workDir, 'backups', backupName));
    openDatabases.push(backup);
    expect(
      backup.prepare('SELECT count(*) AS n FROM VRChatPhotoPathModels').get(),
    ).toEqual({ n: 1 });
    expect(
      backup
        .prepare(
          "SELECT count(*) AS n FROM sqlite_master WHERE name = '__drizzle_migrations'",
        )
        .get(),
    ).toEqual({ n: 0 });
  });

  it('古い DB に足りないテーブル・列・インデックスを足して引き継ぐ', async () => {
    const target = openFileDatabase(SEQUELIZE_FIXTURE);
    target.sqlite.exec(`
      DROP TABLE VRChatPhotoMetadataModels;
      DROP INDEX \`world-joinDateTime-idx\`;
      ALTER TABLE VRChatPlayerLeaveLogModels DROP COLUMN playerId;
      ALTER TABLE VRChatPhotoPathModels DROP COLUMN width;
    `);

    await migrate(target);

    const fresh = new DatabaseSync(':memory:');
    openDatabases.push(fresh);
    fresh.exec(SEQUELIZE_FIXTURE);
    const tables = normalize(readTableDefinitions(target.sqlite));
    const leaveLog = tables.find(
      (t) => t.name === 'VRChatPlayerLeaveLogModels',
    );
    expect(leaveLog?.columns.map((c) => c.name)).toContain('playerId');
    const photoPath = tables.find((t) => t.name === 'VRChatPhotoPathModels');
    expect(photoPath?.columns.find((c) => c.name === 'width')).toMatchObject({
      notnull: 1,
      dflt_value: '1280',
    });
    expect(
      tables
        .find((t) => t.name === 'VRChatWorldJoinLogModels')
        ?.indexes.map((i) => i.name),
    ).toContain('world-joinDateTime-idx');
    expect(tables.map((t) => t.name)).toContain('VRChatPhotoMetadataModels');

    // 足した列の既定値が既存の行に入る
    expect(
      target.sqlite.prepare('SELECT width FROM VRChatPhotoPathModels').get(),
    ).toEqual({ width: 1280 });
    expect(appliedMigrationNames(target.sqlite)).toHaveLength(1);
  });

  it('名前が違っても同じ列のインデックスがあれば足さない', async () => {
    const target = openFileDatabase(SEQUELIZE_FIXTURE);
    target.sqlite.exec(`
      DROP INDEX v_r_chat_photo_path_models_photo_path_unique;
      CREATE UNIQUE INDEX v_r_chat_photo_path_models_photo_path ON VRChatPhotoPathModels (photoPath);
    `);

    await migrate(target);

    const indexes = target.sqlite
      .prepare("PRAGMA index_list('VRChatPhotoPathModels')")
      .all()
      .map((row) => row.name);
    expect(indexes).toContain('v_r_chat_photo_path_models_photo_path');
    expect(indexes).not.toContain(
      'v_r_chat_photo_path_models_photo_path_unique',
    );
  });

  it('自動では直せない食い違いがあれば、DB に触らずに失敗する', async () => {
    const target = openFileDatabase(SEQUELIZE_FIXTURE);
    target.sqlite.exec(`
      ALTER TABLE VRChatPlayerJoinLogModels ADD COLUMN legacyFlag TEXT NOT NULL DEFAULT 'x';
      DROP TABLE VRChatPlayerLeaveLogModels;
      CREATE TABLE VRChatPlayerLeaveLogModels (id TEXT PRIMARY KEY, leaveDateTime INTEGER NOT NULL, playerName TEXT NOT NULL, playerId TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, extra TEXT NOT NULL);
    `);
    const before = sqliteMaster(target.sqlite);

    await expect(migrate(target)).rejects.toMatchObject({
      _tag: 'LegacySchemaIrreconcilable',
      issues: [
        {
          kind: 'COLUMN_TYPE_MISMATCH',
          table: 'VRChatPlayerLeaveLogModels',
          column: 'leaveDateTime',
        },
        {
          kind: 'EXTRA_NOT_NULL_COLUMN',
          table: 'VRChatPlayerLeaveLogModels',
          column: 'extra',
        },
      ],
    });
    expect(sqliteMaster(target.sqlite)).toEqual(before);
  });

  it('補修の途中で失敗したら巻き戻し、DB を元のままにする', async () => {
    const target = openFileDatabase(SEQUELIZE_FIXTURE);
    // 一意インデックスを足せないよう、同じ photoPath の行を入れておく
    target.sqlite.exec(`
      DROP INDEX v_r_chat_photo_path_models_photo_path_unique;
      INSERT INTO VRChatPhotoPathModels (id, photoPath, photoTakenAt, height, width, createdAt, updatedAt)
        VALUES ('dup', '/p/a.png', '2024-01-31 23:30:15.123 +00:00', 1, 1, '2024-01-31 23:30:15.123 +00:00', '2024-01-31 23:30:15.123 +00:00');
      DROP INDEX \`world-joinDateTime-idx\`;
    `);
    const before = sqliteMaster(target.sqlite);

    await expect(migrate(target)).rejects.toMatchObject({
      _tag: 'LegacyTakeoverFailed',
    });
    expect(sqliteMaster(target.sqlite)).toEqual(before);
  });

  it('2 回目以降は何もしない', async () => {
    const target = openFileDatabase(SEQUELIZE_FIXTURE);
    await migrate(target);
    const masterAfterFirst = sqliteMaster(target.sqlite);
    const migrationsAfterFirst = appliedMigrationNames(target.sqlite);

    await migrate(target);

    expect(sqliteMaster(target.sqlite)).toEqual(masterAfterFirst);
    expect(appliedMigrationNames(target.sqlite)).toEqual(migrationsAfterFirst);
    expect(backups()).toHaveLength(1);
  });
});
