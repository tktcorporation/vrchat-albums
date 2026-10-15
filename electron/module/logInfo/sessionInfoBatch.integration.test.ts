import { EventEmitter } from 'node:events';

import { parseISO } from 'date-fns';
import { Effect } from 'effect';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as client from '../../lib/sequelize';
import {
  OptionalVRChatPlayerIdSchema,
  VRChatPlayerNameSchema,
  VRChatWorldIdSchema,
  VRChatWorldInstanceIdSchema,
  VRChatWorldNameSchema,
} from '../vrchatLog/model';
import * as playerJoinLogService from '../VRChatPlayerJoinLogModel/playerJoinLog.service';
import * as worldJoinLogService from '../vrchatWorldJoinLog/service';
import { createVRChatWorldJoinLogFromPhoto } from '../vrchatWorldJoinLogFromPhoto/service';
import { logInfoRouter } from './logInfoCointroller';

/** テスト用にワールド参加ログを 1 件作る */
const createWorldJoin = (
  worldSuffix: string,
  worldName: string,
  joinDate: Date,
) =>
  Effect.runPromise(
    worldJoinLogService.createVRChatWorldJoinLogModel([
      {
        logType: 'worldJoin' as const,
        worldId: VRChatWorldIdSchema.parse(
          `wrld_${worldSuffix}-0000-0000-0000-000000000000`,
        ),
        worldName: VRChatWorldNameSchema.parse(worldName),
        worldInstanceId: VRChatWorldInstanceIdSchema.parse('12345'),
        joinDate,
      },
    ]),
  );

/** テスト用にプレイヤー参加ログを 1 件作る */
const createPlayerJoin = (playerName: string, joinDate: Date) =>
  Effect.runPromise(
    playerJoinLogService.createVRChatPlayerJoinLogModel([
      {
        logType: 'playerJoin' as const,
        playerId: OptionalVRChatPlayerIdSchema.parse(null),
        playerName: VRChatPlayerNameSchema.parse(playerName),
        joinDate,
      },
    ]),
  );

/** getSessionInfoBatch を呼び出す */
const callBatch = (joinDateTimes: Date[]) => {
  // oxlint-disable-next-line unicorn/prefer-event-target -- tRPC context requires EventEmitter for emit() support
  const eventEmitter = new EventEmitter();
  return logInfoRouter()
    .createCaller({ eventEmitter })
    .getSessionInfoBatch(joinDateTimes);
};

describe('SessionInfoBatch world change behavior', () => {
  beforeAll(async () => {
    await client.__initTestRDBClient();
  }, 10000);

  beforeEach(async () => {
    await client.__forceSyncRDBClient();
  });

  afterAll(async () => {
    await client.__cleanupTestRDBClient();
  });

  it('should NOT include players from previous world when world changes', async () => {
    // シナリオ:
    // 1. World A に 10:00 に参加
    // 2. Player1 が 10:10 に参加
    // 3. Player2 が 10:20 に参加
    // 4. World B に 10:30 に参加（World A から退出）
    // 5. Player3 が 10:40 に参加

    // タイムスタンプ
    const worldAJoinTime = parseISO('2024-01-01T10:00:00Z');
    const player1JoinTime = parseISO('2024-01-01T10:10:00Z');
    const player2JoinTime = parseISO('2024-01-01T10:20:00Z');
    const worldBJoinTime = parseISO('2024-01-01T10:30:00Z');
    const player3JoinTime = parseISO('2024-01-01T10:40:00Z');

    // World A に参加
    await Effect.runPromise(
      worldJoinLogService.createVRChatWorldJoinLogModel([
        {
          logType: 'worldJoin' as const,
          worldId: VRChatWorldIdSchema.parse(
            'wrld_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          ),
          worldName: VRChatWorldNameSchema.parse('World A'),
          worldInstanceId: VRChatWorldInstanceIdSchema.parse('12345'),
          joinDate: worldAJoinTime,
        },
      ]),
    );

    // World A でプレイヤーが参加
    await Effect.runPromise(
      playerJoinLogService.createVRChatPlayerJoinLogModel([
        {
          logType: 'playerJoin' as const,
          playerId: OptionalVRChatPlayerIdSchema.parse(
            'usr_11111111-1111-1111-1111-111111111111',
          ),
          playerName: VRChatPlayerNameSchema.parse('Player1'),
          joinDate: player1JoinTime,
        },
        {
          logType: 'playerJoin' as const,
          playerId: OptionalVRChatPlayerIdSchema.parse(
            'usr_22222222-2222-2222-2222-222222222222',
          ),
          playerName: VRChatPlayerNameSchema.parse('Player2'),
          joinDate: player2JoinTime,
        },
      ]),
    );

    // World B に参加（World A から退出）
    await Effect.runPromise(
      worldJoinLogService.createVRChatWorldJoinLogModel([
        {
          logType: 'worldJoin' as const,
          worldId: VRChatWorldIdSchema.parse(
            'wrld_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          ),
          worldName: VRChatWorldNameSchema.parse('World B'),
          worldInstanceId: VRChatWorldInstanceIdSchema.parse('67890'),
          joinDate: worldBJoinTime,
        },
      ]),
    );

    // World B でプレイヤーが参加
    await Effect.runPromise(
      playerJoinLogService.createVRChatPlayerJoinLogModel([
        {
          logType: 'playerJoin' as const,
          playerId: OptionalVRChatPlayerIdSchema.parse(
            'usr_33333333-3333-3333-3333-333333333333',
          ),
          playerName: VRChatPlayerNameSchema.parse('Player3'),
          joinDate: player3JoinTime,
        },
      ]),
    );

    // テスト実行
    const router = logInfoRouter();
    // oxlint-disable-next-line unicorn/prefer-event-target -- tRPC context requires EventEmitter for emit() support
    const eventEmitter = new EventEmitter();

    // World A のセッション情報を取得（10:00の時点）
    const worldAResult = await router
      .createCaller({ eventEmitter })
      .getSessionInfoBatch([worldAJoinTime]);

    const worldASession = worldAResult[worldAJoinTime.toISOString()];

    // World A のセッションには Player1 と Player2 が含まれるべき
    expect(worldASession).toBeDefined();
    expect(worldASession.worldName).toBe('World A');
    expect(worldASession.players).toHaveLength(2);
    expect(worldASession.players.map((p) => p.playerName).toSorted()).toEqual([
      'Player1',
      'Player2',
    ]);

    // World B のセッション情報を取得（10:30の時点）
    const worldBResult = await router
      .createCaller({ eventEmitter })
      .getSessionInfoBatch([worldBJoinTime]);

    const worldBSession = worldBResult[worldBJoinTime.toISOString()];

    // World B のセッションには Player3 のみが含まれるべき
    // Player1 と Player2 は含まれてはいけない（前のワールドのプレイヤー）
    expect(worldBSession).toBeDefined();
    expect(worldBSession.worldName).toBe('World B');
    expect(worldBSession.players).toHaveLength(1);
    expect(worldBSession.players[0].playerName).toBe('Player3');
  });

  it('should handle multiple world changes correctly', async () => {
    // より複雑なシナリオ: 複数回のワールド移動
    const worldXJoinTime = parseISO('2024-01-02T08:00:00Z');
    const playerXJoinTime = parseISO('2024-01-02T08:10:00Z');
    const worldYJoinTime = parseISO('2024-01-02T09:00:00Z');
    const playerYJoinTime = parseISO('2024-01-02T09:10:00Z');
    const worldZJoinTime = parseISO('2024-01-02T10:00:00Z');
    const playerZJoinTime = parseISO('2024-01-02T10:10:00Z');

    // 3つのワールドに順番に参加
    await Effect.runPromise(
      worldJoinLogService.createVRChatWorldJoinLogModel([
        {
          logType: 'worldJoin' as const,
          worldId: VRChatWorldIdSchema.parse(
            'wrld_12345678-1234-5678-abcd-123456789abc',
          ),
          worldName: VRChatWorldNameSchema.parse('World X'),
          worldInstanceId: VRChatWorldInstanceIdSchema.parse('11111'),
          joinDate: worldXJoinTime,
        },
      ]),
    );

    await Effect.runPromise(
      playerJoinLogService.createVRChatPlayerJoinLogModel([
        {
          logType: 'playerJoin' as const,
          playerId: OptionalVRChatPlayerIdSchema.parse(
            'usr_12345678-1234-5678-abcd-123456789abc',
          ),
          playerName: VRChatPlayerNameSchema.parse('PlayerX'),
          joinDate: playerXJoinTime,
        },
      ]),
    );

    await Effect.runPromise(
      worldJoinLogService.createVRChatWorldJoinLogModel([
        {
          logType: 'worldJoin' as const,
          worldId: VRChatWorldIdSchema.parse(
            'wrld_87654321-4321-8765-dcba-987654321cba',
          ),
          worldName: VRChatWorldNameSchema.parse('World Y'),
          worldInstanceId: VRChatWorldInstanceIdSchema.parse('22222'),
          joinDate: worldYJoinTime,
        },
      ]),
    );

    await Effect.runPromise(
      playerJoinLogService.createVRChatPlayerJoinLogModel([
        {
          logType: 'playerJoin' as const,
          playerId: OptionalVRChatPlayerIdSchema.parse(
            'usr_87654321-4321-8765-dcba-987654321cba',
          ),
          playerName: VRChatPlayerNameSchema.parse('PlayerY'),
          joinDate: playerYJoinTime,
        },
      ]),
    );

    await Effect.runPromise(
      worldJoinLogService.createVRChatWorldJoinLogModel([
        {
          logType: 'worldJoin' as const,
          worldId: VRChatWorldIdSchema.parse(
            'wrld_abcdef12-3456-7890-abcd-ef1234567890',
          ),
          worldName: VRChatWorldNameSchema.parse('World Z'),
          worldInstanceId: VRChatWorldInstanceIdSchema.parse('33333'),
          joinDate: worldZJoinTime,
        },
      ]),
    );

    await Effect.runPromise(
      playerJoinLogService.createVRChatPlayerJoinLogModel([
        {
          logType: 'playerJoin' as const,
          playerId: OptionalVRChatPlayerIdSchema.parse(
            'usr_abcdef12-3456-7890-abcd-ef1234567890',
          ),
          playerName: VRChatPlayerNameSchema.parse('PlayerZ'),
          joinDate: playerZJoinTime,
        },
      ]),
    );

    // バッチで全セッション情報を取得
    const router = logInfoRouter();
    // oxlint-disable-next-line unicorn/prefer-event-target -- tRPC context requires EventEmitter for emit() support
    const eventEmitter = new EventEmitter();

    const batchResult = await router
      .createCaller({ eventEmitter })
      .getSessionInfoBatch([worldXJoinTime, worldYJoinTime, worldZJoinTime]);

    // 各ワールドのセッションを確認
    const worldXSession = batchResult[worldXJoinTime.toISOString()];
    const worldYSession = batchResult[worldYJoinTime.toISOString()];
    const worldZSession = batchResult[worldZJoinTime.toISOString()];

    // World X には PlayerX のみ
    expect(worldXSession.players).toHaveLength(1);
    expect(worldXSession.players[0].playerName).toBe('PlayerX');

    // World Y には PlayerY のみ（PlayerX は含まれない）
    expect(worldYSession.players).toHaveLength(1);
    expect(worldYSession.players[0].playerName).toBe('PlayerY');

    // World Z には PlayerZ のみ（PlayerX, PlayerY は含まれない）
    expect(worldZSession.players).toHaveLength(1);
    expect(worldZSession.players[0].playerName).toBe('PlayerZ');
  });

  it('500ms 差で参加した 2 つのワールドは、それぞれ自分の区間のプレイヤーだけを返す', async () => {
    const w1 = parseISO('2024-01-03T10:00:00.000');
    const w2 = parseISO('2024-01-03T10:00:00.500');
    await createWorldJoin('11111111', 'World 1', w1);
    await createWorldJoin('22222222', 'World 2', w2);
    await createPlayerJoin('InW1', parseISO('2024-01-03T10:00:00.200'));
    await createPlayerJoin('InW2', parseISO('2024-01-03T10:00:00.700'));

    const result = await callBatch([w1, w2]);

    expect(result[w1.toISOString()].worldName).toBe('World 1');
    expect(result[w1.toISOString()].players.map((p) => p.playerName)).toEqual([
      'InW1',
    ]);
    expect(result[w2.toISOString()].worldName).toBe('World 2');
    expect(result[w2.toISOString()].players.map((p) => p.playerName)).toEqual([
      'InW2',
    ]);
  });

  it('次のワールドへの参加ちょうどに入ったプレイヤーは次のワールドに属する', async () => {
    const w1 = parseISO('2024-01-04T10:00:00');
    const w2 = parseISO('2024-01-04T11:00:00');
    await createWorldJoin('33333333', 'World 1', w1);
    await createWorldJoin('44444444', 'World 2', w2);
    await createPlayerJoin('JustBefore', parseISO('2024-01-04T10:59:59.999'));
    await createPlayerJoin('AtBoundary', w2);

    const result = await callBatch([w1, w2]);

    expect(result[w1.toISOString()].players.map((p) => p.playerName)).toEqual([
      'JustBefore',
    ]);
    expect(result[w2.toISOString()].players.map((p) => p.playerName)).toEqual([
      'AtBoundary',
    ]);
  });

  it('写真由来の参加ログもセッションの区切りとして扱う', async () => {
    const normalJoin = parseISO('2024-01-05T10:00:00');
    const photoJoin = parseISO('2024-01-05T10:30:00');
    await createWorldJoin('55555555', 'Normal World', normalJoin);
    await createVRChatWorldJoinLogFromPhoto([
      { worldId: 'wrld_photo', joinDate: photoJoin },
    ]);
    await createPlayerJoin('BeforePhoto', parseISO('2024-01-05T10:10:00'));
    await createPlayerJoin('AfterPhoto', parseISO('2024-01-05T10:45:00'));

    const result = await callBatch([normalJoin, photoJoin]);

    expect(
      result[normalJoin.toISOString()].players.map((p) => p.playerName),
    ).toEqual(['BeforePhoto']);
    expect(result[photoJoin.toISOString()].worldId).toBe('wrld_photo');
    expect(
      result[photoJoin.toISOString()].players.map((p) => p.playerName),
    ).toEqual(['AfterPhoto']);
  });

  it('前のセッションだけを要求しても、後の参加ログで区間が閉じる', async () => {
    const w1 = parseISO('2024-01-07T10:00:00');
    const w2 = parseISO('2024-01-07T11:00:00');
    await createWorldJoin('77777777', 'World 1', w1);
    await createWorldJoin('88888888', 'World 2', w2);
    await createPlayerJoin('InW1', parseISO('2024-01-07T10:30:00'));
    await createPlayerJoin('InW2', parseISO('2024-01-07T11:30:00'));

    const result = await callBatch([w1]);

    expect(result[w1.toISOString()].worldName).toBe('World 1');
    expect(result[w1.toISOString()].players.map((p) => p.playerName)).toEqual([
      'InW1',
    ]);
  });

  it('前のセッションだけを要求しても、後の写真由来の参加ログで区間が閉じる', async () => {
    const w1 = parseISO('2024-01-08T10:00:00');
    const photoJoin = parseISO('2024-01-08T11:00:00');
    await createWorldJoin('99999999', 'World 1', w1);
    await createVRChatWorldJoinLogFromPhoto([
      { worldId: 'wrld_photo_after', joinDate: photoJoin },
    ]);
    await createPlayerJoin('InW1', parseISO('2024-01-08T10:30:00'));
    await createPlayerJoin('AfterPhoto', parseISO('2024-01-08T11:30:00'));

    const result = await callBatch([w1]);

    expect(result[w1.toISOString()].worldName).toBe('World 1');
    expect(result[w1.toISOString()].players.map((p) => p.playerName)).toEqual([
      'InW1',
    ]);
  });

  it('セッションの開始日時ではない日時には空のセッションを返す', async () => {
    const w1 = parseISO('2024-01-06T10:00:00');
    await createWorldJoin('66666666', 'World 1', w1);
    await createPlayerJoin('Someone', parseISO('2024-01-06T10:10:00'));
    const insideSession = parseISO('2024-01-06T10:05:00');

    const result = await callBatch([insideSession]);

    expect(result[insideSession.toISOString()].worldId).toBeNull();
    expect(result[insideSession.toISOString()].players).toEqual([]);
  });

  it('returns an empty session when no world join log precedes the time', async () => {
    const router = logInfoRouter();
    // oxlint-disable-next-line unicorn/prefer-event-target -- tRPC context requires EventEmitter for emit() support
    const eventEmitter = new EventEmitter();
    const time = parseISO('2024-01-01T10:00:00');

    const result = await router
      .createCaller({ eventEmitter })
      .getSessionInfoBatch([time]);

    expect(result[time.toISOString()]?.worldId).toBeNull();
    expect(result[time.toISOString()]?.players).toEqual([]);
  });
});
