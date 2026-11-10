import { Effect } from 'effect';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as client from '../../lib/db/client';
import {
  vrchatPlayerJoinLogs,
  vrchatPlayerLeaveLogs,
  vrchatWorldJoinLogs,
} from '../../lib/db/schema';
import { getDBQueue } from '../../lib/dbQueue';
import {
  OptionalVRChatPlayerIdSchema,
  VRChatPlayerNameSchema,
  VRChatWorldIdSchema,
  VRChatWorldInstanceIdSchema,
  VRChatWorldNameSchema,
} from '../vrchatLog/model';
import type {
  VRChatPlayerJoinLog,
  VRChatWorldJoinLog,
} from '../vrchatLog/service';
import { insertVRChatPlayerJoinLogs } from '../VRChatPlayerJoinLogModel/playerJoinInfoLog.model';
import { insertVRChatPlayerLeaveLogs } from '../VRChatPlayerLeaveLogModel/playerLeaveLog.model';
import { insertVRChatWorldJoinLogs } from '../vrchatWorldJoinLog/VRChatWorldJoinLogModel/s_model';

/**
 * ログの一括登録（`loadLogInfoIndexFromVRChatLog` の手順 5）と同じ組み立てで、
 * 3 種類のログを 1 つのトランザクションで書き込む。
 */
const worldJoin = (joinDate: Date): VRChatWorldJoinLog => ({
  logType: 'worldJoin',
  worldId: VRChatWorldIdSchema.parse(
    'wrld_00000000-0000-0000-0000-000000000000',
  ),
  worldName: VRChatWorldNameSchema.parse('World'),
  worldInstanceId: VRChatWorldInstanceIdSchema.parse('12345'),
  joinDate,
});

const playerJoin = (
  playerName: string,
  joinDate: Date,
): VRChatPlayerJoinLog => ({
  logType: 'playerJoin',
  playerId: OptionalVRChatPlayerIdSchema.parse(null),
  playerName: VRChatPlayerNameSchema.parse(playerName),
  joinDate,
});

const countRows = () => ({
  world: client.getDB().select().from(vrchatWorldJoinLogs).all().length,
  playerJoin: client.getDB().select().from(vrchatPlayerJoinLogs).all().length,
  playerLeave: client.getDB().select().from(vrchatPlayerLeaveLogs).all().length,
});

describe('ログの一括登録のトランザクション', () => {
  beforeAll(async () => {
    await client.__initTestRDBClient();
  });
  beforeEach(() => {
    client.__resetTestRDBClient();
  });
  afterAll(() => {
    client.__cleanupTestRDBClient();
  });

  const joinDate = new Date(2024, 0, 1, 10, 0, 0);

  it('途中で投げたら、それまでに書いた 3 種類のログをすべて巻き戻す', async () => {
    await expect(
      Effect.runPromise(
        getDBQueue().transaction((tx) => {
          insertVRChatWorldJoinLogs(tx, [worldJoin(joinDate)]);
          insertVRChatPlayerJoinLogs(tx, [playerJoin('Alice', joinDate)]);
          insertVRChatPlayerLeaveLogs(tx, [
            { leaveDateTime: joinDate, playerName: 'Alice', playerId: null },
          ]);
          throw new Error('batch failed');
        }, 'test.batchInsert'),
      ),
    ).rejects.toThrow('batch failed');

    expect(countRows()).toEqual({ world: 0, playerJoin: 0, playerLeave: 0 });
  });

  it('コミットした後は、同じログをもう一度渡しても新しく登録した行だけを返す', async () => {
    const insertAll = () =>
      Effect.runPromise(
        getDBQueue().transaction((tx) => ({
          world: insertVRChatWorldJoinLogs(tx, [worldJoin(joinDate)]),
          player: insertVRChatPlayerJoinLogs(tx, [
            playerJoin('Alice', joinDate),
            playerJoin('Alice', joinDate),
            playerJoin('Bob', joinDate),
          ]),
        })),
      );

    const first = await insertAll();
    expect(first.world).toHaveLength(1);
    expect(first.player.map((row) => row.playerName)).toEqual(['Alice', 'Bob']);

    const second = await insertAll();
    expect(second.world).toEqual([]);
    expect(second.player).toEqual([]);
    expect(countRows()).toEqual({ world: 1, playerJoin: 2, playerLeave: 0 });
  });
});
