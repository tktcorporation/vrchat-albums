import { asc, gt, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  __cleanupTestRDBClient,
  __initTestRDBClient,
  __resetTestRDBClient,
  getDB,
  getRawSQLite,
} from './client';
import { vrchatPhotoPaths } from './schema';
import { formatUtcDateTime, parseUtcDateTime } from './utcDateTime';

describe('formatUtcDateTime / parseUtcDateTime', () => {
  it('UTC の YYYY-MM-DD HH:MM:SS.SSS +00:00 で書き、同じ時刻に読み戻す', () => {
    const date = new Date(Date.UTC(2024, 0, 31, 23, 30, 15, 123));

    const stored = formatUtcDateTime(date);

    expect(stored).toBe('2024-01-31 23:30:15.123 +00:00');
    expect(parseUtcDateTime(stored).getTime()).toBe(date.getTime());
  });

  it.each([
    ['2024-01-31T23:30:15.123Z', Date.UTC(2024, 0, 31, 23, 30, 15, 123)],
    ['2024-01-31 23:30:15 +00:00', Date.UTC(2024, 0, 31, 23, 30, 15)],
    ['2024-01-31 23:30:15.1', Date.UTC(2024, 0, 31, 23, 30, 15, 100)],
    ['2024-02-01 08:30:15.123 +09:00', Date.UTC(2024, 0, 31, 23, 30, 15, 123)],
    ['2024-01-31 18:30:15.123 -05:00', Date.UTC(2024, 0, 31, 23, 30, 15, 123)],
  ])('%s を読める', (stored, expectedMillis) => {
    expect(parseUtcDateTime(stored).getTime()).toBe(expectedMillis);
  });

  it('日時の形をしていない値は投げる', () => {
    expect(() => parseUtcDateTime('Invalid date')).toThrow(
      'Unexpected date-time value',
    );
  });

  it('無効な日付は書かずに投げる', () => {
    expect(() => formatUtcDateTime(new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe('日時の列（DB）', () => {
  beforeAll(async () => {
    await __initTestRDBClient();
  });
  beforeEach(() => {
    __resetTestRDBClient();
  });
  afterAll(() => {
    __cleanupTestRDBClient();
  });

  /** 既存の DB に Sequelize が書いた行と同じ形で、SQL を直接書いて行を入れる */
  const insertLegacyRow = (id: string, photoTakenAt: string) => {
    getRawSQLite()
      .prepare(
        `INSERT INTO VRChatPhotoPathModels (id, photoPath, photoTakenAt, height, width, createdAt, updatedAt)
         VALUES (?, ?, ?, 720, 1280, ?, ?)`,
      )
      .run(id, `/legacy/${id}.png`, photoTakenAt, photoTakenAt, photoTakenAt);
  };

  const insertRow = (id: string, photoTakenAt: Date) => {
    getDB()
      .insert(vrchatPhotoPaths)
      .values({ id, photoPath: `/new/${id}.png`, photoTakenAt })
      .run();
  };

  it('新しく書いた行は既存の行と同じ形式で保存される', () => {
    insertRow('new', new Date(Date.UTC(2024, 0, 31, 23, 30, 15, 123)));

    expect(
      getRawSQLite()
        .prepare('SELECT photoTakenAt, createdAt FROM VRChatPhotoPathModels')
        .get(),
    ).toEqual({
      photoTakenAt: '2024-01-31 23:30:15.123 +00:00',
      createdAt: expect.stringMatching(
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} \+00:00$/,
      ),
    });
  });

  it('既存の行と新しい行が混ざっても、日時の順に並び、日時で絞り込める', () => {
    insertLegacyRow('legacy-1', '2024-01-01 00:00:00.000 +00:00');
    insertRow('new-1', new Date(Date.UTC(2024, 0, 1, 12, 0, 0, 0)));
    insertLegacyRow('legacy-2', '2024-01-02 00:00:00.000 +00:00');
    insertRow('new-2', new Date(Date.UTC(2023, 11, 31, 23, 59, 59, 999)));

    const ordered = getDB()
      .select({ id: vrchatPhotoPaths.id })
      .from(vrchatPhotoPaths)
      .orderBy(asc(vrchatPhotoPaths.photoTakenAt))
      .all()
      .map((row) => row.id);
    expect(ordered).toEqual(['new-2', 'legacy-1', 'new-1', 'legacy-2']);

    const after = getDB()
      .select({ id: vrchatPhotoPaths.id })
      .from(vrchatPhotoPaths)
      .where(
        gt(
          vrchatPhotoPaths.photoTakenAt,
          new Date(Date.UTC(2024, 0, 1, 0, 0, 0, 0)),
        ),
      )
      .orderBy(asc(vrchatPhotoPaths.photoTakenAt))
      .all()
      .map((row) => row.id);
    expect(after).toEqual(['new-1', 'legacy-2']);
  });

  it('SQLite の日時関数がタイムゾーンを読み取れる形式で保存される', () => {
    insertRow('new', new Date(Date.UTC(2024, 0, 31, 23, 30, 15, 123)));
    insertLegacyRow('legacy', '2024-01-31 23:30:15.123 +00:00');

    const months = getDB()
      .select({
        month: sql<string>`strftime('%Y-%m-%d %H:%M', ${vrchatPhotoPaths.photoTakenAt})`,
      })
      .from(vrchatPhotoPaths)
      .all()
      .map((row) => row.month);
    expect(months).toEqual(['2024-01-31 23:30', '2024-01-31 23:30']);
  });
});
