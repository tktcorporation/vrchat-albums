import * as datefns from 'date-fns';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearAllCaches } from '../../lib/queryCache';
import * as initRDBClient from '../../lib/sequelize';
import * as playerJoinLogService from '../VRChatPlayerJoinLogModel/playerJoinLog.service';
import {
  VRChatPlayerIdSchema,
  VRChatPlayerNameSchema,
  VRChatWorldIdSchema,
  VRChatWorldInstanceIdSchema,
  VRChatWorldNameSchema,
} from '../vrchatLog/model';
import type { VRChatWorldJoinLog } from '../vrchatLog/service';
import * as worldJoinLogService from '../vrchatWorldJoinLog/service';
import { getPlayerJoinListInSameWorld } from './logInfoCointroller';

// 実際のデータベースを使用した統合テスト
describe('getPlayerJoinListInSameWorld 統合テスト', () => {
  beforeAll(async () => {
    await initRDBClient.__initTestRDBClient();
  }, 10000);

  beforeEach(async () => {
    await initRDBClient.__forceSyncRDBClient();
    clearAllCaches();
  });

  afterAll(async () => {
    await initRDBClient.__cleanupTestRDBClient();
  });

  it('実DB: プレイヤー参加ログが取得できる場合', async () => {
    // テストデータの作成
    const baseDate = datefns.parseISO('2023-01-01T12:00:00Z');

    // ワールド参加ログを作成
    const worldJoinLogs: VRChatWorldJoinLog[] = [
      {
        worldId: VRChatWorldIdSchema.parse(
          'wrld_12345678-1234-1234-1234-123456789012',
        ),
        worldName: VRChatWorldNameSchema.parse('Test World'),
        worldInstanceId: VRChatWorldInstanceIdSchema.parse('instance1'),
        joinDate: datefns.subMinutes(baseDate, 30), // 30分前
        logType: 'worldJoin',
      },
      {
        worldId: VRChatWorldIdSchema.parse(
          'wrld_87654321-4321-4321-4321-210987654321',
        ),
        worldName: VRChatWorldNameSchema.parse('Next World'),
        worldInstanceId: VRChatWorldInstanceIdSchema.parse('instance2'),
        joinDate: datefns.addMinutes(baseDate, 30), // 30分後
        logType: 'worldJoin',
      },
    ];

    await worldJoinLogService.createVRChatWorldJoinLogModel(worldJoinLogs);

    // プレイヤー参加ログを作成
    const playerJoinLogs = [
      {
        joinDate: datefns.subMinutes(baseDate, 20), // 20分前
        playerName: VRChatPlayerNameSchema.parse('Player 1'),
        logType: 'playerJoin' as const,
        playerId: null,
      },
      {
        joinDate: datefns.subMinutes(baseDate, 10), // 10分前
        playerName: VRChatPlayerNameSchema.parse('Player 2'),
        logType: 'playerJoin' as const,
        playerId: null,
      },
      {
        joinDate: baseDate, // 基準時刻
        playerName: VRChatPlayerNameSchema.parse('Player 3'),
        logType: 'playerJoin' as const,
        playerId: null,
      },
      {
        joinDate: datefns.addMinutes(baseDate, 10), // 10分後
        playerName: VRChatPlayerNameSchema.parse('Player 4'),
        logType: 'playerJoin' as const,
        playerId: null,
      },
    ];

    await playerJoinLogService.createVRChatPlayerJoinLogModel(playerJoinLogs);

    // 関数を実行
    const result = await getPlayerJoinListInSameWorld(baseDate);

    // 期待される結果
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      // プレイヤー名を確認
      const playerNames = result.value.map((player) => player.playerName);
      expect(playerNames.length).toBeGreaterThan(0);

      // 少なくとも1人のプレイヤーが含まれていることを確認
      expect(
        playerNames.some((name) =>
          ['Player 1', 'Player 2', 'Player 3', 'Player 4'].includes(name),
        ),
      ).toBe(true);
    }
  });

  it('実DB: 異なる時間帯でのセッション境界の処理', async () => {
    // テストデータの作成
    const baseDate = datefns.parseISO('2023-06-15T14:30:00Z');

    // 複数のワールド参加ログを作成（時系列順）
    const worldJoinLogs: VRChatWorldJoinLog[] = [
      {
        worldId: VRChatWorldIdSchema.parse(
          'wrld_aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        ),
        worldName: VRChatWorldNameSchema.parse('Morning World'),
        worldInstanceId: VRChatWorldInstanceIdSchema.parse('instance1'),
        joinDate: datefns.subHours(baseDate, 3), // 3時間前
        logType: 'worldJoin',
      },
      {
        worldId: VRChatWorldIdSchema.parse(
          'wrld_bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        ),
        worldName: VRChatWorldNameSchema.parse('Afternoon World'),
        worldInstanceId: VRChatWorldInstanceIdSchema.parse('instance2'),
        joinDate: datefns.subHours(baseDate, 1), // 1時間前
        logType: 'worldJoin',
      },
      {
        worldId: VRChatWorldIdSchema.parse(
          'wrld_cccccccc-cccc-cccc-cccc-cccccccccccc',
        ),
        worldName: VRChatWorldNameSchema.parse('Evening World'),
        worldInstanceId: VRChatWorldInstanceIdSchema.parse('instance3'),
        joinDate: datefns.addHours(baseDate, 2), // 2時間後
        logType: 'worldJoin',
      },
    ];

    await worldJoinLogService.createVRChatWorldJoinLogModel(worldJoinLogs);

    // 各セッションに対応するプレイヤー参加ログを作成
    const playerJoinLogs = [
      // Morning World のプレイヤー
      {
        joinDate: datefns.subHours(baseDate, 2.5),
        playerName: VRChatPlayerNameSchema.parse('Morning Player 1'),
        logType: 'playerJoin' as const,
        playerId: VRChatPlayerIdSchema.parse(
          'usr_12345678-1234-1234-1234-123456789012',
        ),
      },
      {
        joinDate: datefns.subHours(baseDate, 2),
        playerName: VRChatPlayerNameSchema.parse('Morning Player 2'),
        logType: 'playerJoin' as const,
        playerId: VRChatPlayerIdSchema.parse(
          'usr_22345678-1234-1234-1234-123456789012',
        ),
      },
      // Afternoon World のプレイヤー
      {
        joinDate: datefns.subMinutes(baseDate, 45),
        playerName: VRChatPlayerNameSchema.parse('Afternoon Player 1'),
        logType: 'playerJoin' as const,
        playerId: VRChatPlayerIdSchema.parse(
          'usr_32345678-1234-1234-1234-123456789012',
        ),
      },
      {
        joinDate: datefns.subMinutes(baseDate, 30),
        playerName: VRChatPlayerNameSchema.parse('Afternoon Player 2'),
        logType: 'playerJoin' as const,
        playerId: VRChatPlayerIdSchema.parse(
          'usr_42345678-1234-1234-1234-123456789012',
        ),
      },
      {
        joinDate: datefns.subMinutes(baseDate, 15),
        playerName: VRChatPlayerNameSchema.parse('Afternoon Player 3'),
        logType: 'playerJoin' as const,
        playerId: VRChatPlayerIdSchema.parse(
          'usr_52345678-1234-1234-1234-123456789012',
        ),
      },
      // Evening World のプレイヤー
      {
        joinDate: datefns.addHours(baseDate, 2.5),
        playerName: VRChatPlayerNameSchema.parse('Evening Player 1'),
        logType: 'playerJoin' as const,
        playerId: VRChatPlayerIdSchema.parse(
          'usr_62345678-1234-1234-1234-123456789012',
        ),
      },
    ];

    await playerJoinLogService.createVRChatPlayerJoinLogModel(playerJoinLogs);

    // 基準時刻で関数を実行（Afternoon World のセッション中）
    const result = await getPlayerJoinListInSameWorld(baseDate);

    // 期待される結果
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const playerNames = result.value.map((player) => player.playerName);

      // Afternoon World のプレイヤーのみが取得されることを確認
      expect(playerNames).toContain('Afternoon Player 1');
      expect(playerNames).toContain('Afternoon Player 2');
      expect(playerNames).toContain('Afternoon Player 3');

      // 他のセッションのプレイヤーが含まれていないことを確認
      expect(playerNames).not.toContain('Morning Player 1');
      expect(playerNames).not.toContain('Morning Player 2');
      expect(playerNames).not.toContain('Evening Player 1');

      // 正確に3人のプレイヤーが取得されることを確認
      expect(playerNames).toHaveLength(3);
    }
  });

  it('実DB: 最新のセッション（次のワールド参加ログなし）の処理', async () => {
    const baseDate = datefns.parseISO('2023-12-31T23:30:00Z');

    // 現在のセッションのみ（最新のワールド）
    const worldJoinLogs: VRChatWorldJoinLog[] = [
      {
        worldId: VRChatWorldIdSchema.parse(
          'wrld_11111111-1111-1111-1111-111111111111',
        ),
        worldName: VRChatWorldNameSchema.parse('Latest World'),
        worldInstanceId: VRChatWorldInstanceIdSchema.parse('12345'),
        joinDate: datefns.subHours(baseDate, 2), // 2時間前から現在のセッション
        logType: 'worldJoin',
      },
    ];

    await worldJoinLogService.createVRChatWorldJoinLogModel(worldJoinLogs);

    // 現在のセッションのプレイヤー
    const playerJoinLogs = [
      {
        joinDate: datefns.subHours(baseDate, 1.5),
        playerName: VRChatPlayerNameSchema.parse('Current Player 1'),
        logType: 'playerJoin' as const,
        playerId: VRChatPlayerIdSchema.parse(
          'usr_72345678-1234-1234-1234-123456789012',
        ),
      },
      {
        joinDate: datefns.subHours(baseDate, 1),
        playerName: VRChatPlayerNameSchema.parse('Current Player 2'),
        logType: 'playerJoin' as const,
        playerId: VRChatPlayerIdSchema.parse(
          'usr_82345678-1234-1234-1234-123456789012',
        ),
      },
      {
        joinDate: datefns.subMinutes(baseDate, 30),
        playerName: VRChatPlayerNameSchema.parse('Current Player 3'),
        logType: 'playerJoin' as const,
        playerId: VRChatPlayerIdSchema.parse(
          'usr_92345678-1234-1234-1234-123456789012',
        ),
      },
      {
        joinDate: baseDate,
        playerName: VRChatPlayerNameSchema.parse('Current Player 4'),
        logType: 'playerJoin' as const,
        playerId: VRChatPlayerIdSchema.parse(
          'usr_a2345678-1234-1234-1234-123456789012',
        ),
      },
    ];

    await playerJoinLogService.createVRChatPlayerJoinLogModel(playerJoinLogs);

    // 関数を実行
    const result = await getPlayerJoinListInSameWorld(
      datefns.addMinutes(baseDate, 15), // 基準時刻を少し未来に設定
    );

    // 期待される結果
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const playerNames = result.value.map((player) => player.playerName);

      // 全てのプレイヤーが取得されることを確認
      expect(playerNames).toContain('Current Player 1');
      expect(playerNames).toContain('Current Player 2');
      expect(playerNames).toContain('Current Player 3');
      expect(playerNames).toContain('Current Player 4');
      expect(playerNames).toHaveLength(4);
    }
  });

  it('実DB: 空のデータベースでの処理', async () => {
    // データベースは空の状態（beforeEachでクリア済み）
    const baseDate = datefns.parseISO('2023-01-01T00:00:00Z');

    // 関数を実行
    const result = await getPlayerJoinListInSameWorld(baseDate);

    // 期待される結果：エラーが返される
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBe('RECENT_JOIN_LOG_NOT_FOUND');
    }
  });
});
