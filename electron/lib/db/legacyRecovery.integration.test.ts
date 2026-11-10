import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';

import { Effect } from 'effect';
import path from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeRDBClient,
  getRawSQLite,
  initRDBClient,
  migrateRDBClient,
} from './client';
import { planLegacyRecovery, setAsideLegacyDatabase } from './legacyRecovery';
import { TABLE_REBUILD_SOURCES } from './schema';

/** アプリのバージョン 0.31.6 が作った DB（行を含む） */
const SEQUELIZE_FIXTURE = readFileSync(
  path.join(import.meta.dirname, '__fixtures__', 'sequelize-v0.31.6.sql'),
  'utf8',
);

let workDir: string;
let dbPath: string;

beforeEach(() => {
  workDir = mkdtempSync(path.join(tmpdir(), 'vrchat-albums-recovery-'));
  dbPath = path.join(workDir, 'db.sqlite');
});

afterEach(() => {
  closeRDBClient();
  rmSync(workDir, { recursive: true, force: true });
});

const backupNames = () => readdirSync(path.join(workDir, 'backups')).toSorted();

/** Sequelize の時代の DB をファイルに作り、`extraSql` で食い違いを足す */
const writeLegacyDatabase = (extraSql: string) => {
  const sqlite = new DatabaseSync(dbPath);
  sqlite.exec('PRAGMA journal_mode=WAL');
  sqlite.exec(SEQUELIZE_FIXTURE);
  sqlite.exec(extraSql);
  sqlite.close();
};

const rowCount = (sqlite: DatabaseSync, table: string) =>
  sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get();

describe('planLegacyRecovery', () => {
  it('アプリのテーブルはどれもログの保存先か写真のフォルダから作り直せる', () => {
    expect(planLegacyRecovery(TABLE_REBUILD_SOURCES)).toEqual({
      kind: 'rebuild',
    });
  });

  it('作り直せないテーブルがあれば、その名前を返して止める', () => {
    expect(
      planLegacyRecovery({
        ...TABLE_REBUILD_SOURCES,
        UserNotes: 'none',
      }),
    ).toEqual({ kind: 'stop', nonDerivableTables: ['UserNotes'] });
  });
});

describe('setAsideLegacyDatabase', () => {
  it('DB の本体と -wal を一緒に移す', async () => {
    writeFileSync(dbPath, 'main');
    writeFileSync(`${dbPath}-wal`, 'wal');

    const setAsidePath = await Effect.runPromise(
      setAsideLegacyDatabase({
        dbPath,
        backupDir: path.join(workDir, 'backups'),
        now: new Date(),
      }),
    );

    expect(existsSync(dbPath)).toBe(false);
    expect(existsSync(`${dbPath}-wal`)).toBe(false);
    expect(readFileSync(setAsidePath, 'utf8')).toBe('main');
    expect(readFileSync(`${setAsidePath}-wal`, 'utf8')).toBe('wal');
  });

  it('本体を移せなければ、移していないことを返す', async () => {
    const result = await Effect.runPromise(
      Effect.flip(
        setAsideLegacyDatabase({
          dbPath,
          backupDir: path.join(workDir, 'backups'),
          now: new Date(),
        }),
      ),
    );

    expect(result.movedMainFile).toBe(false);
  });
});

describe('migrateRDBClient で引き継げなかった DB', () => {
  it('食い違いが直せなければ、複製を残して退避し、空の DB を作り直す', async () => {
    writeLegacyDatabase(`
      DROP TABLE VRChatPlayerLeaveLogModels;
      CREATE TABLE VRChatPlayerLeaveLogModels (id TEXT PRIMARY KEY, leaveDateTime INTEGER NOT NULL, playerName TEXT NOT NULL, playerId TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
    `);
    initRDBClient({ db_url: dbPath });

    const outcome = await migrateRDBClient();

    expect(outcome).toMatchObject({
      kind: 'rebuilt',
      backupPath: expect.stringContaining('db-before-drizzle-'),
      setAsidePath: expect.stringContaining('db-unrecoverable-'),
      reason: {
        _tag: 'LegacySchemaIrreconcilable',
        issues: [{ kind: 'COLUMN_TYPE_MISMATCH' }],
      },
    });
    // 同じ場所の DB は空で、マイグレーションを適用済み
    const fresh = getRawSQLite();
    expect(rowCount(fresh, 'VRChatPhotoPathModels')).toEqual({ n: 0 });
    expect(rowCount(fresh, '__drizzle_migrations')).toEqual({ n: 1 });
    expect(
      fresh
        .prepare("SELECT name FROM sqlite_master WHERE name = 'Migrations'")
        .get(),
    ).toBeUndefined();

    // 複製と退避した DB には元の行がある
    const names = backupNames();
    expect(names.filter((name) => name.endsWith('.sqlite'))).toEqual([
      expect.stringMatching(/^db-before-drizzle-/),
      expect.stringMatching(/^db-unrecoverable-/),
    ]);
    for (const name of names.filter((n) => n.endsWith('.sqlite'))) {
      const copy = new DatabaseSync(path.join(workDir, 'backups', name));
      expect(rowCount(copy, 'VRChatPhotoPathModels')).toEqual({ n: 1 });
      copy.close();
    }

    // 次の起動では作り直さない
    expect(await migrateRDBClient()).toEqual({ kind: 'migrated' });
  });

  it('補修の途中で失敗しても、退避して空の DB を作り直す', async () => {
    // 一意インデックスを足せないよう、同じ photoPath の行を入れておく
    writeLegacyDatabase(`
      DROP INDEX v_r_chat_photo_path_models_photo_path_unique;
      INSERT INTO VRChatPhotoPathModels (id, photoPath, photoTakenAt, height, width, createdAt, updatedAt)
        VALUES ('dup', '/p/a.png', '2024-01-31 23:30:15.123 +00:00', 1, 1, 'x', 'x');
    `);
    initRDBClient({ db_url: dbPath });

    const outcome = await migrateRDBClient();

    expect(outcome).toMatchObject({
      kind: 'rebuilt',
      reason: { _tag: 'LegacyTakeoverFailed' },
    });
    expect(rowCount(getRawSQLite(), 'VRChatPhotoPathModels')).toEqual({
      n: 0,
    });
  });
});
