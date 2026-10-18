import { parseISO } from 'date-fns';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as client from '../../lib/sequelize';
import type { WorldId } from '../vrchatLog/type';
import {
  createVRChatWorldJoinLogFromPhoto,
  findVRChatWorldJoinLogFromPhotoList,
} from './service';
import { VRChatWorldJoinLogFromPhotoModel } from './vrchatWorldJoinLogFromPhoto.model';

const WORLD_A = 'wrld_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' as WorldId;
const WORLD_B = 'wrld_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' as WorldId;

describe('vrchatWorldJoinLogFromPhoto service', () => {
  beforeAll(async () => {
    await client.__initTestRDBClient();
  }, 10000);

  beforeEach(async () => {
    await client.__forceSyncRDBClient();
  });

  afterAll(async () => {
    await client.__cleanupTestRDBClient();
  });

  describe('createVRChatWorldJoinLogFromPhoto', () => {
    it('空配列を渡すと何も保存せず空配列を返す', async () => {
      const created = await createVRChatWorldJoinLogFromPhoto([]);

      expect(created).toEqual([]);
      expect(await VRChatWorldJoinLogFromPhotoModel.count()).toBe(0);
    });

    it('worldId と joinDate を joinDateTime 列に対応付けて保存する', async () => {
      const joinDate = parseISO('2024-01-01T10:00:00');

      const created = await createVRChatWorldJoinLogFromPhoto([
        { worldId: WORLD_A, joinDate },
      ]);

      expect(created).toHaveLength(1);
      const rows = await VRChatWorldJoinLogFromPhotoModel.findAll();
      expect(rows).toHaveLength(1);
      expect(rows[0].worldId).toBe(WORLD_A);
      expect(rows[0].joinDateTime.getTime()).toBe(joinDate.getTime());
      expect(rows[0]).toMatchObject({
        id: expect.any(String),
        createdAt: expect.any(Date),
      });
    });

    it('ローカル時刻として解釈した日時がそのまま往復する', async () => {
      // 写真ファイル名の日時はローカル時刻として扱う（timezone ルール）
      const joinDate = parseISO('2024-03-10T23:59:59.999');

      await createVRChatWorldJoinLogFromPhoto([{ worldId: WORLD_A, joinDate }]);

      const [row] = await findVRChatWorldJoinLogFromPhotoList({
        orderByJoinDateTime: 'asc',
      });
      expect(row.joinDate.getTime()).toBe(joinDate.getTime());
      expect(row.joinDate.getHours()).toBe(23);
      expect(row.joinDate.getDate()).toBe(10);
    });

    it('同じ worldId と joinDate の組を再投入しても行は増えない（冪等）', async () => {
      const log = {
        worldId: WORLD_A,
        joinDate: parseISO('2024-01-01T10:00:00'),
      };

      await createVRChatWorldJoinLogFromPhoto([log]);
      await createVRChatWorldJoinLogFromPhoto([log]);

      expect(await VRChatWorldJoinLogFromPhotoModel.count()).toBe(1);
    });

    it('1 回の投入内の重複も 1 行にまとめる', async () => {
      const joinDate = parseISO('2024-01-01T10:00:00');

      await createVRChatWorldJoinLogFromPhoto([
        { worldId: WORLD_A, joinDate },
        { worldId: WORLD_A, joinDate },
      ]);

      expect(await VRChatWorldJoinLogFromPhotoModel.count()).toBe(1);
    });

    it('同じ日時でも worldId が違えば別の行として保存する', async () => {
      const joinDate = parseISO('2024-01-01T10:00:00');

      await createVRChatWorldJoinLogFromPhoto([
        { worldId: WORLD_A, joinDate },
        { worldId: WORLD_B, joinDate },
      ]);

      expect(await VRChatWorldJoinLogFromPhotoModel.count()).toBe(2);
    });

    it('同じ worldId でも日時が 1ms 違えば別の行として保存する', async () => {
      await createVRChatWorldJoinLogFromPhoto([
        { worldId: WORLD_A, joinDate: parseISO('2024-01-01T10:00:00.000') },
        { worldId: WORLD_A, joinDate: parseISO('2024-01-01T10:00:00.001') },
      ]);

      expect(await VRChatWorldJoinLogFromPhotoModel.count()).toBe(2);
    });

    it('入力オブジェクトの余分なプロパティは保存対象にしない', async () => {
      const logWithExtra = {
        worldId: WORLD_A,
        joinDate: parseISO('2024-01-01T10:00:00'),
        worldName: 'should be dropped',
      };

      await createVRChatWorldJoinLogFromPhoto([logWithExtra]);

      const [row] = await VRChatWorldJoinLogFromPhotoModel.findAll({
        raw: true,
      });
      expect(row).not.toHaveProperty('worldName');
    });
  });

  describe('findVRChatWorldJoinLogFromPhotoList', () => {
    const seed = async () => {
      await createVRChatWorldJoinLogFromPhoto([
        { worldId: WORLD_B, joinDate: parseISO('2024-01-02T10:00:00') },
        { worldId: WORLD_A, joinDate: parseISO('2024-01-01T10:00:00') },
        { worldId: WORLD_A, joinDate: parseISO('2024-01-03T10:00:00') },
      ]);
    };

    it('データが無ければ空配列を返す', async () => {
      expect(await findVRChatWorldJoinLogFromPhotoList()).toEqual([]);
    });

    it('クエリ省略時は全件を joinDate 昇順で返す', async () => {
      await seed();

      const result = await findVRChatWorldJoinLogFromPhotoList();

      expect(result.map((r) => r.joinDate)).toEqual([
        parseISO('2024-01-01T10:00:00'),
        parseISO('2024-01-02T10:00:00'),
        parseISO('2024-01-03T10:00:00'),
      ]);
    });

    it('サービス層の形（id, worldId, joinDate, createdAt, updatedAt）に整形して返す', async () => {
      await createVRChatWorldJoinLogFromPhoto([
        { worldId: WORLD_A, joinDate: parseISO('2024-01-01T10:00:00') },
      ]);

      const [row] = await findVRChatWorldJoinLogFromPhotoList();

      expect(Object.keys(row).toSorted()).toEqual(
        ['createdAt', 'id', 'joinDate', 'updatedAt', 'worldId'].toSorted(),
      );
      expect(row.id).toEqual(expect.any(String));
      expect(row.worldId).toBe(WORLD_A);
      expect(row.joinDate).toEqual(parseISO('2024-01-01T10:00:00'));
      expect(row.createdAt).toBeInstanceOf(Date);
    });

    it('orderByJoinDateTime: desc で joinDate 降順に返す', async () => {
      await seed();

      const result = await findVRChatWorldJoinLogFromPhotoList({
        orderByJoinDateTime: 'desc',
      });

      expect(result.map((r) => r.joinDate)).toEqual([
        parseISO('2024-01-03T10:00:00'),
        parseISO('2024-01-02T10:00:00'),
        parseISO('2024-01-01T10:00:00'),
      ]);
    });

    it('gtJoinDateTime / ltJoinDateTime は境界値を含まない（開区間）', async () => {
      await seed();

      const result = await findVRChatWorldJoinLogFromPhotoList({
        gtJoinDateTime: parseISO('2024-01-01T10:00:00'),
        ltJoinDateTime: parseISO('2024-01-03T10:00:00'),
        orderByJoinDateTime: 'asc',
      });

      expect(result.map((r) => r.joinDate)).toEqual([
        parseISO('2024-01-02T10:00:00'),
      ]);
    });

    it('境界の 1ms 内側にある行は範囲に含める', async () => {
      await seed();

      const result = await findVRChatWorldJoinLogFromPhotoList({
        gtJoinDateTime: parseISO('2024-01-01T09:59:59.999'),
        ltJoinDateTime: parseISO('2024-01-03T10:00:00.001'),
        orderByJoinDateTime: 'asc',
      });

      expect(result).toHaveLength(3);
    });

    it('gtJoinDateTime だけを指定すると下限のみで絞り込む', async () => {
      await seed();

      const result = await findVRChatWorldJoinLogFromPhotoList({
        gtJoinDateTime: parseISO('2024-01-02T00:00:00'),
        orderByJoinDateTime: 'asc',
      });

      expect(result.map((r) => r.joinDate)).toEqual([
        parseISO('2024-01-02T10:00:00'),
        parseISO('2024-01-03T10:00:00'),
      ]);
    });

    it('ltJoinDateTime だけを指定すると上限のみで絞り込む', async () => {
      await seed();

      const result = await findVRChatWorldJoinLogFromPhotoList({
        ltJoinDateTime: parseISO('2024-01-02T00:00:00'),
        orderByJoinDateTime: 'asc',
      });

      expect(result.map((r) => r.joinDate)).toEqual([
        parseISO('2024-01-01T10:00:00'),
      ]);
    });

    it('limit は並び順の先頭から数える', async () => {
      await seed();

      const asc = await findVRChatWorldJoinLogFromPhotoList({
        orderByJoinDateTime: 'asc',
        limit: 2,
      });
      const desc = await findVRChatWorldJoinLogFromPhotoList({
        orderByJoinDateTime: 'desc',
        limit: 1,
      });

      expect(asc.map((r) => r.joinDate)).toEqual([
        parseISO('2024-01-01T10:00:00'),
        parseISO('2024-01-02T10:00:00'),
      ]);
      expect(desc.map((r) => r.joinDate)).toEqual([
        parseISO('2024-01-03T10:00:00'),
      ]);
    });

    it('limit: 0 は 0 件を返す（省略とは区別する）', async () => {
      await seed();

      const result = await findVRChatWorldJoinLogFromPhotoList({
        orderByJoinDateTime: 'asc',
        limit: 0,
      });

      expect(result).toEqual([]);
    });

    it('範囲と limit を組み合わせると、範囲内を並べてから先頭を取る', async () => {
      await seed();

      const result = await findVRChatWorldJoinLogFromPhotoList({
        gtJoinDateTime: parseISO('2024-01-01T12:00:00'),
        orderByJoinDateTime: 'desc',
        limit: 1,
      });

      expect(result.map((r) => r.joinDate)).toEqual([
        parseISO('2024-01-03T10:00:00'),
      ]);
    });
  });
});
