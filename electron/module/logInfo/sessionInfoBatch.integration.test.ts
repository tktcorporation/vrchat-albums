import { EventEmitter } from 'node:events';
import { parseISO } from 'date-fns';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as client from '../../lib/sequelize';
import * as playerJoinLogService from '../VRChatPlayerJoinLogModel/playerJoinLog.service';
import {
  OptionalVRChatPlayerIdSchema,
  VRChatPlayerNameSchema,
  VRChatWorldIdSchema,
  VRChatWorldInstanceIdSchema,
  VRChatWorldNameSchema,
} from '../vrchatLog/model';
import * as worldJoinLogService from '../vrchatWorldJoinLog/service';
import { logInfoRouter } from './logInfoCointroller';

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
    await worldJoinLogService.createVRChatWorldJoinLogModel([
      {
        logType: 'worldJoin' as const,
        worldId: VRChatWorldIdSchema.parse(
          'wrld_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        ),
        worldName: VRChatWorldNameSchema.parse('World A'),
        worldInstanceId: VRChatWorldInstanceIdSchema.parse('12345'),
        joinDate: worldAJoinTime,
      },
    ]);

    // World A でプレイヤーが参加
    await playerJoinLogService.createVRChatPlayerJoinLogModel([
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
    ]);

    // World B に参加（World A から退出）
    await worldJoinLogService.createVRChatWorldJoinLogModel([
      {
        logType: 'worldJoin' as const,
        worldId: VRChatWorldIdSchema.parse(
          'wrld_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        ),
        worldName: VRChatWorldNameSchema.parse('World B'),
        worldInstanceId: VRChatWorldInstanceIdSchema.parse('67890'),
        joinDate: worldBJoinTime,
      },
    ]);

    // World B でプレイヤーが参加
    await playerJoinLogService.createVRChatPlayerJoinLogModel([
      {
        logType: 'playerJoin' as const,
        playerId: OptionalVRChatPlayerIdSchema.parse(
          'usr_33333333-3333-3333-3333-333333333333',
        ),
        playerName: VRChatPlayerNameSchema.parse('Player3'),
        joinDate: player3JoinTime,
      },
    ]);

    // テスト実行
    const router = logInfoRouter();
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
    expect(worldASession.players.map((p) => p.playerName).sort()).toEqual([
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
    await worldJoinLogService.createVRChatWorldJoinLogModel([
      {
        logType: 'worldJoin' as const,
        worldId: VRChatWorldIdSchema.parse(
          'wrld_12345678-1234-5678-abcd-123456789abc',
        ),
        worldName: VRChatWorldNameSchema.parse('World X'),
        worldInstanceId: VRChatWorldInstanceIdSchema.parse('11111'),
        joinDate: worldXJoinTime,
      },
    ]);

    await playerJoinLogService.createVRChatPlayerJoinLogModel([
      {
        logType: 'playerJoin' as const,
        playerId: OptionalVRChatPlayerIdSchema.parse(
          'usr_12345678-1234-5678-abcd-123456789abc',
        ),
        playerName: VRChatPlayerNameSchema.parse('PlayerX'),
        joinDate: playerXJoinTime,
      },
    ]);

    await worldJoinLogService.createVRChatWorldJoinLogModel([
      {
        logType: 'worldJoin' as const,
        worldId: VRChatWorldIdSchema.parse(
          'wrld_87654321-4321-8765-dcba-987654321cba',
        ),
        worldName: VRChatWorldNameSchema.parse('World Y'),
        worldInstanceId: VRChatWorldInstanceIdSchema.parse('22222'),
        joinDate: worldYJoinTime,
      },
    ]);

    await playerJoinLogService.createVRChatPlayerJoinLogModel([
      {
        logType: 'playerJoin' as const,
        playerId: OptionalVRChatPlayerIdSchema.parse(
          'usr_87654321-4321-8765-dcba-987654321cba',
        ),
        playerName: VRChatPlayerNameSchema.parse('PlayerY'),
        joinDate: playerYJoinTime,
      },
    ]);

    await worldJoinLogService.createVRChatWorldJoinLogModel([
      {
        logType: 'worldJoin' as const,
        worldId: VRChatWorldIdSchema.parse(
          'wrld_abcdef12-3456-7890-abcd-ef1234567890',
        ),
        worldName: VRChatWorldNameSchema.parse('World Z'),
        worldInstanceId: VRChatWorldInstanceIdSchema.parse('33333'),
        joinDate: worldZJoinTime,
      },
    ]);

    await playerJoinLogService.createVRChatPlayerJoinLogModel([
      {
        logType: 'playerJoin' as const,
        playerId: OptionalVRChatPlayerIdSchema.parse(
          'usr_abcdef12-3456-7890-abcd-ef1234567890',
        ),
        playerName: VRChatPlayerNameSchema.parse('PlayerZ'),
        joinDate: playerZJoinTime,
      },
    ]);

    // バッチで全セッション情報を取得
    const router = logInfoRouter();
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
});
