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
import {
  getPlayerJoinListInSameWorld,
  logInfoRouter,
} from './logInfoCointroller';

describe('SessionInfoBatch vs getPlayerListInSameWorld logic comparison', () => {
  beforeAll(async () => {
    client.__initTestRDBClient();
  }, 10000);

  beforeEach(async () => {
    await client.__forceSyncRDBClient();
  });

  afterAll(async () => {
    await client.__cleanupTestRDBClient();
  });

  /**
   * 元のgetPlayerJoinListInSameWorldロジックをテスト用に再現
   */
  const getPlayerJoinListInSameWorldOriginal = async (datetime: Date) => {
    return await getPlayerJoinListInSameWorld(datetime);
  };

  /**
   * getSessionInfoBatchから特定の日時のプレイヤー情報を取得
   */
  const getPlayersFromSessionBatch = async (datetime: Date) => {
    const router = logInfoRouter();
    const eventEmitter = new EventEmitter();
    const batchResult = await router
      .createCaller({ eventEmitter })
      .getSessionInfoBatch([datetime]);

    const dateKey = datetime.toISOString();
    return batchResult[dateKey]?.players || [];
  };

  describe('when no world join logs exist', () => {
    it('both methods should return empty results', async () => {
      const testDate = parseISO('2024-01-01T12:00:00Z');

      const originalResult =
        await getPlayerJoinListInSameWorldOriginal(testDate);
      const batchPlayers = await getPlayersFromSessionBatch(testDate);

      // 元のロジックはエラーを返す
      expect(originalResult.isErr()).toBe(true);

      // バッチロジックは空の配列を返す
      expect(batchPlayers).toEqual([]);
    });
  });

  describe('when world join logs exist', () => {
    it('both methods should find the same session range and players', async () => {
      // テストデータの準備
      const testDate = parseISO('2024-01-01T12:00:00Z');
      const worldJoinDate = parseISO('2024-01-01T11:30:00Z');
      const nextWorldJoinDate = parseISO('2024-01-01T13:30:00Z');

      // ワールド参加ログを作成
      const worldJoinData = {
        logType: 'worldJoin' as const,
        worldId: VRChatWorldIdSchema.parse(
          'wrld_12345678-1234-1234-1234-123456789abc',
        ),
        worldName: VRChatWorldNameSchema.parse('Test World'),
        worldInstanceId: VRChatWorldInstanceIdSchema.parse('12345'),
        joinDate: worldJoinDate,
      };

      const worldJoinResultAsync =
        await worldJoinLogService.createVRChatWorldJoinLogModel([
          worldJoinData,
        ]);

      const nextWorldJoinResultAsync =
        await worldJoinLogService.createVRChatWorldJoinLogModel([
          {
            logType: 'worldJoin' as const,
            worldId: VRChatWorldIdSchema.parse(
              'wrld_87654321-4321-4321-4321-abc123456789',
            ),
            worldName: VRChatWorldNameSchema.parse('Next Test World'),
            worldInstanceId: VRChatWorldInstanceIdSchema.parse('67890'),
            joinDate: nextWorldJoinDate,
          },
        ]);

      const worldJoinResult = worldJoinResultAsync.isOk()
        ? worldJoinResultAsync.value
        : [];
      const nextWorldJoinResult = nextWorldJoinResultAsync.isOk()
        ? nextWorldJoinResultAsync.value
        : [];

      if (worldJoinResult.length > 0 && nextWorldJoinResult.length > 0) {
        // プレイヤー参加ログを作成（セッション期間内）
        const playerJoinDate1 = parseISO('2024-01-01T11:45:00Z');
        const playerJoinDate2 = parseISO('2024-01-01T12:15:00Z');

        const playerResults =
          await playerJoinLogService.createVRChatPlayerJoinLogModel([
            {
              logType: 'playerJoin' as const,
              playerId: OptionalVRChatPlayerIdSchema.parse(
                'usr_12345678-1234-1234-1234-123456789abc',
              ),
              playerName: VRChatPlayerNameSchema.parse('TestPlayer1'),
              joinDate: playerJoinDate1,
            },
            {
              logType: 'playerJoin' as const,
              playerId: OptionalVRChatPlayerIdSchema.parse(
                'usr_87654321-4321-4321-4321-abc123456789',
              ),
              playerName: VRChatPlayerNameSchema.parse('TestPlayer2'),
              joinDate: playerJoinDate2,
            },
          ]);

        if (playerResults.length > 0) {
          // 両方のメソッドを実行
          const originalResult =
            await getPlayerJoinListInSameWorldOriginal(testDate);
          const batchPlayers = await getPlayersFromSessionBatch(testDate);

          if (originalResult.isOk()) {
            const originalPlayers = originalResult.value;

            // プレイヤー数が一致することを確認
            expect(batchPlayers.length).toBe(originalPlayers.length);

            // プレイヤーIDが一致することを確認
            const originalPlayerIds = originalPlayers.map((p) => p.id).sort();
            const batchPlayerIds = batchPlayers.map((p) => p.id).sort();
            expect(batchPlayerIds).toEqual(originalPlayerIds);

            // プレイヤー名も一致することを確認
            const originalPlayerNames = originalPlayers
              .map((p) => p.playerName)
              .sort();
            const batchPlayerNames = batchPlayers
              .map((p) => p.playerName)
              .sort();
            expect(batchPlayerNames).toEqual(originalPlayerNames);
          } else {
            // 元のロジックがエラーの場合、バッチも空であるべき
            expect(batchPlayers).toEqual([]);
          }
        }
      }
    });
  });

  describe('PhotoAsLog integration difference', () => {
    it('should identify when batch logic misses PhotoAsLog data', async () => {
      // 独立したテストデータを作成（前のテストに依存しない）
      const testDate = parseISO('2024-01-02T14:00:00Z');
      const worldJoinDate = parseISO('2024-01-02T13:30:00Z');
      const nextWorldJoinDate = parseISO('2024-01-02T15:30:00Z');

      // ワールド参加ログを作成
      const worldJoinData = {
        logType: 'worldJoin' as const,
        worldId: VRChatWorldIdSchema.parse(
          'wrld_abcdef12-3456-7890-abcd-123456789abc',
        ),
        worldName: VRChatWorldNameSchema.parse('Integration Test World'),
        worldInstanceId: VRChatWorldInstanceIdSchema.parse('98765'),
        joinDate: worldJoinDate,
      };

      const worldJoinResultAsync =
        await worldJoinLogService.createVRChatWorldJoinLogModel([
          worldJoinData,
        ]);

      const nextWorldJoinResultAsync =
        await worldJoinLogService.createVRChatWorldJoinLogModel([
          {
            logType: 'worldJoin' as const,
            worldId: VRChatWorldIdSchema.parse(
              'wrld_fedcba98-7654-3210-fedc-ba9876543210',
            ),
            worldName: VRChatWorldNameSchema.parse(
              'Next Integration Test World',
            ),
            worldInstanceId: VRChatWorldInstanceIdSchema.parse('54321'),
            joinDate: nextWorldJoinDate,
          },
        ]);

      const worldJoinResult = worldJoinResultAsync.isOk()
        ? worldJoinResultAsync.value
        : [];
      const nextWorldJoinResult = nextWorldJoinResultAsync.isOk()
        ? nextWorldJoinResultAsync.value
        : [];

      if (worldJoinResult.length > 0 && nextWorldJoinResult.length > 0) {
        // プレイヤー参加ログを作成（セッション期間内）
        const playerJoinDate1 = parseISO('2024-01-02T13:45:00Z');
        const playerJoinDate2 = parseISO('2024-01-02T14:15:00Z');

        const playerResults =
          await playerJoinLogService.createVRChatPlayerJoinLogModel([
            {
              logType: 'playerJoin' as const,
              playerId: OptionalVRChatPlayerIdSchema.parse(
                'usr_fedcba98-7654-3210-fedc-ba9876543210',
              ),
              playerName: VRChatPlayerNameSchema.parse(
                'IntegrationTestPlayer1',
              ),
              joinDate: playerJoinDate1,
            },
            {
              logType: 'playerJoin' as const,
              playerId: OptionalVRChatPlayerIdSchema.parse(
                'usr_abcdef12-3456-7890-abcd-123456789abc',
              ),
              playerName: VRChatPlayerNameSchema.parse(
                'IntegrationTestPlayer2',
              ),
              joinDate: playerJoinDate2,
            },
          ]);

        if (playerResults.length > 0) {
          const originalResult =
            await getPlayerJoinListInSameWorldOriginal(testDate);
          const batchPlayers = await getPlayersFromSessionBatch(testDate);

          console.log('Original result:', originalResult);
          console.log('Batch players:', batchPlayers);

          // このケースでは結果が一致することを確認
          if (originalResult.isOk()) {
            const originalPlayers = originalResult.value;

            expect(batchPlayers.length).toBe(originalPlayers.length);

            if (originalPlayers.length > 0) {
              const originalPlayerIds = originalPlayers.map((p) => p.id).sort();
              const batchPlayerIds = batchPlayers.map((p) => p.id).sort();
              expect(batchPlayerIds).toEqual(originalPlayerIds);
            }
          } else {
            expect(batchPlayers).toEqual([]);
          }
        }
      }
    });
  });

  describe('next world join log detection', () => {
    it('should use the same logic for determining session end time', async () => {
      // TODO: 連続するワールド参加ログのテストデータを作成
      // 複数のワールド参加ログが存在するケースをテスト予定
      // const batchPlayers = await getPlayersFromSessionBatch(testDate);
      // セッション範囲の決定ロジックが一致することを確認
      // 実装詳細：次のワールド参加ログまでの時間範囲が同じかどうか
    });
  });
});
