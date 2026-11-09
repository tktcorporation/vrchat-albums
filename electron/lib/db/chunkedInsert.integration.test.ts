import { count } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  VRChatWorldIdSchema,
  VRChatWorldInstanceIdSchema,
  VRChatWorldNameSchema,
} from '../../module/vrchatLog/model';
import type { VRChatWorldJoinLog } from '../../module/vrchatLog/service';
import { createOrUpdateListVRChatPhotoPath } from '../../module/vrchatPhoto/model/vrchatPhotoPath.model';
import { createOrUpdatePhotoMetadataBatch } from '../../module/vrchatPhotoMetadata/vrchatPhotoMetadata.model';
import { insertVRChatWorldJoinLogs } from '../../module/vrchatWorldJoinLog/VRChatWorldJoinLogModel/s_model';
import {
  createVRChatWorldJoinLogFromPhoto,
  type VRChatWorldJoinLogFromPhoto,
} from '../../module/vrchatWorldJoinLogFromPhoto/vrchatWorldJoinLogFromPhoto.model';
import { rowsPerInsert } from './chunkedInsert';
import * as client from './client';
import {
  vrchatPhotoMetadata,
  vrchatPhotoPaths,
  vrchatWorldJoinLogs,
  vrchatWorldJoinLogsFromPhoto,
} from './schema';

/**
 * SQLite が 1 つの文に束縛できるパラメータの上限（32766）を、1 回の呼び出しで超える行数。
 * 列の最も多いテーブル（写真のメタデータ、8 列）で 7000 × 8 = 56000 になる
 */
const ROW_COUNT = 7000;

const BASE_TIME = Date.UTC(2024, 0, 1);

const worldId = (i: number) =>
  VRChatWorldIdSchema.parse(
    `wrld_00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
  );

const worldJoin = (i: number): VRChatWorldJoinLog => ({
  logType: 'worldJoin',
  worldId: worldId(i),
  worldName: VRChatWorldNameSchema.parse(`World ${i}`),
  worldInstanceId: VRChatWorldInstanceIdSchema.parse(String(10_000 + i)),
  joinDate: new Date(BASE_TIME + i * 1000),
});

const countOf = (
  table:
    | typeof vrchatPhotoMetadata
    | typeof vrchatPhotoPaths
    | typeof vrchatWorldJoinLogs
    | typeof vrchatWorldJoinLogsFromPhoto,
) => client.getDB().select({ n: count() }).from(table).get()?.n;

describe('パラメータの上限を超える行数の一括登録', () => {
  beforeAll(async () => {
    await client.__initTestRDBClient();
  });
  beforeEach(() => {
    client.__resetTestRDBClient();
  });
  afterAll(() => {
    client.__cleanupTestRDBClient();
  });

  it('1 文の行数はパラメータの上限と 1000 行のうち小さい方に収まる', () => {
    for (const table of [
      vrchatPhotoMetadata,
      vrchatPhotoPaths,
      vrchatWorldJoinLogs,
      vrchatWorldJoinLogsFromPhoto,
    ]) {
      expect(rowsPerInsert(table)).toBeLessThanOrEqual(1000);
    }
  });

  it('写真のメタデータを登録し、同じ photoPath はもう一度呼ぶと更新する', async () => {
    const attributes = Array.from({ length: ROW_COUNT }, (_, i) => ({
      photoPath: `/photos/${i}.png`,
      authorId: 'usr_a',
      authorDisplayName: 'Before',
      worldId: null,
      worldDisplayName: null,
    }));

    expect(await createOrUpdatePhotoMetadataBatch(attributes)).toHaveLength(
      ROW_COUNT,
    );
    const updated = await createOrUpdatePhotoMetadataBatch(
      attributes.map((a) => ({ ...a, authorDisplayName: 'After' })),
    );

    expect(updated).toHaveLength(ROW_COUNT);
    expect(updated.every((row) => row.authorDisplayName === 'After')).toBe(
      true,
    );
    expect(countOf(vrchatPhotoMetadata)).toBe(ROW_COUNT);
  });

  it('写真のパスを登録する', async () => {
    const created = await createOrUpdateListVRChatPhotoPath(
      Array.from({ length: ROW_COUNT }, (_, i) => ({
        photoPath: `/photos/${i}.png`,
        photoTakenAt: new Date(BASE_TIME + i * 1000),
        width: 1920,
        height: 1080,
      })),
    );

    expect(created).toHaveLength(ROW_COUNT);
    expect(countOf(vrchatPhotoPaths)).toBe(ROW_COUNT);
  });

  it('写真から推定したワールドへの参加は、登録済みと重複する行を飛ばして新しい行だけを返す', async () => {
    const logs: VRChatWorldJoinLogFromPhoto[] = Array.from(
      { length: ROW_COUNT },
      (_, i) => ({
        worldId: `wrld_photo-${i}`,
        joinDate: new Date(BASE_TIME + i * 1000),
      }),
    );
    await createVRChatWorldJoinLogFromPhoto(logs.slice(0, 100));

    const created = await createVRChatWorldJoinLogFromPhoto(logs);

    expect(created).toHaveLength(ROW_COUNT - 100);
    expect(countOf(vrchatWorldJoinLogsFromPhoto)).toBe(ROW_COUNT);
  });

  it('呼び出し元のトランザクションの中で分けて登録し、巻き戻すと全部が消える', () => {
    const logs = Array.from({ length: ROW_COUNT }, (_, i) => worldJoin(i));

    expect(() =>
      client.getDB().transaction((tx) => {
        expect(insertVRChatWorldJoinLogs(tx, logs)).toHaveLength(ROW_COUNT);
        throw new Error('rollback');
      }),
    ).toThrow('rollback');

    expect(countOf(vrchatWorldJoinLogs)).toBe(0);
  });

  it('アプリが知らない一意インデックスに当たった行も、エラーにせず飛ばす', () => {
    // 古い DB に残りうる一意インデックス。テストの後で消す
    client
      .getRawSQLite()
      .exec(
        'CREATE UNIQUE INDEX legacy_world_name ON VRChatWorldJoinLogModels (worldName, joinDateTime)',
      );
    const first = worldJoin(1);
    const sameNameOtherInstance: VRChatWorldJoinLog = {
      ...first,
      worldInstanceId: VRChatWorldInstanceIdSchema.parse('99999'),
    };

    const created = insertVRChatWorldJoinLogs(client.getDB(), [
      first,
      sameNameOtherInstance,
    ]);

    client.getRawSQLite().exec('DROP INDEX legacy_world_name');
    expect(created).toHaveLength(1);
  });
});
