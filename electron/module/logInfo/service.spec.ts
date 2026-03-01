import * as datefns from 'date-fns';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as client from '../../lib/sequelize';
import * as service from '../VRChatPlayerJoinLogModel/playerJoinLog.service';
import {
  OptionalVRChatPlayerIdSchema,
  VRChatPlayerNameSchema,
} from '../vrchatLog/model';
import { getFrequentPlayerNames } from './service';

// Remove unused imports

describe('logInfo service', () => {
  describe('getFrequentPlayerNames', () => {
    beforeAll(async () => {
      await client.__initTestRDBClient();
    }, 10000);

    beforeEach(async () => {
      await client.__forceSyncRDBClient();
    });

    afterAll(async () => {
      await client.__cleanupTestRDBClient();
    });

    it('プレイヤー参加ログから頻度順に上位プレイヤー名を取得する', async () => {
      // テストデータの準備 - Player1が最も頻度が高い
      const playerJoinLogList = [
        {
          joinDate: datefns.parseISO('2024-01-01T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('Player1'),
          logType: 'playerJoin' as const,
          playerId: OptionalVRChatPlayerIdSchema.parse(
            'usr_11111111-1111-1111-1111-111111111111',
          ),
        },
        {
          joinDate: datefns.parseISO('2024-01-02T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('Player1'),
          logType: 'playerJoin' as const,
          playerId: OptionalVRChatPlayerIdSchema.parse(
            'usr_11111111-1111-1111-1111-111111111111',
          ),
        },
        {
          joinDate: datefns.parseISO('2024-01-03T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('Player1'),
          logType: 'playerJoin' as const,
          playerId: OptionalVRChatPlayerIdSchema.parse(
            'usr_11111111-1111-1111-1111-111111111111',
          ),
        },
        {
          joinDate: datefns.parseISO('2024-01-01T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('Player2'),
          logType: 'playerJoin' as const,
          playerId: OptionalVRChatPlayerIdSchema.parse(
            'usr_22222222-2222-2222-2222-222222222222',
          ),
        },
        {
          joinDate: datefns.parseISO('2024-01-02T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('Player2'),
          logType: 'playerJoin' as const,
          playerId: OptionalVRChatPlayerIdSchema.parse(
            'usr_22222222-2222-2222-2222-222222222222',
          ),
        },
        {
          joinDate: datefns.parseISO('2024-01-01T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('Player3'),
          logType: 'playerJoin' as const,
          playerId: OptionalVRChatPlayerIdSchema.parse(
            'usr_33333333-3333-3333-3333-333333333333',
          ),
        },
      ];

      await service.createVRChatPlayerJoinLogModel(playerJoinLogList);

      const resultWrapper = await getFrequentPlayerNames(3);
      const result = resultWrapper._unsafeUnwrap();

      // 頻度順（Player1: 3回, Player2: 2回, Player3: 1回）で返されることを確認
      expect(result).toEqual(['Player1', 'Player2', 'Player3']);
    });

    it('limitパラメータが機能することを確認', async () => {
      // 5人のプレイヤーデータを作成
      const playerJoinLogList = [
        {
          joinDate: datefns.parseISO('2024-01-01T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('Player1'),
          logType: 'playerJoin' as const,
          playerId: OptionalVRChatPlayerIdSchema.parse(
            'usr_11111111-1111-1111-1111-111111111111',
          ),
        },
        {
          joinDate: datefns.parseISO('2024-01-02T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('Player1'),
          logType: 'playerJoin' as const,
          playerId: OptionalVRChatPlayerIdSchema.parse(
            'usr_11111111-1111-1111-1111-111111111111',
          ),
        },
        {
          joinDate: datefns.parseISO('2024-01-03T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('Player1'),
          logType: 'playerJoin' as const,
          playerId: OptionalVRChatPlayerIdSchema.parse(
            'usr_11111111-1111-1111-1111-111111111111',
          ),
        },
        {
          joinDate: datefns.parseISO('2024-01-04T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('Player1'),
          logType: 'playerJoin' as const,
          playerId: OptionalVRChatPlayerIdSchema.parse(
            'usr_11111111-1111-1111-1111-111111111111',
          ),
        },
        {
          joinDate: datefns.parseISO('2024-01-05T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('Player1'),
          logType: 'playerJoin' as const,
          playerId: OptionalVRChatPlayerIdSchema.parse(
            'usr_11111111-1111-1111-1111-111111111111',
          ),
        },

        {
          joinDate: datefns.parseISO('2024-01-01T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('Player2'),
          logType: 'playerJoin' as const,
          playerId: OptionalVRChatPlayerIdSchema.parse(
            'usr_22222222-2222-2222-2222-222222222222',
          ),
        },
        {
          joinDate: datefns.parseISO('2024-01-02T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('Player2'),
          logType: 'playerJoin' as const,
          playerId: OptionalVRChatPlayerIdSchema.parse(
            'usr_22222222-2222-2222-2222-222222222222',
          ),
        },
        {
          joinDate: datefns.parseISO('2024-01-03T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('Player2'),
          logType: 'playerJoin' as const,
          playerId: OptionalVRChatPlayerIdSchema.parse(
            'usr_22222222-2222-2222-2222-222222222222',
          ),
        },
        {
          joinDate: datefns.parseISO('2024-01-04T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('Player2'),
          logType: 'playerJoin' as const,
          playerId: OptionalVRChatPlayerIdSchema.parse(
            'usr_22222222-2222-2222-2222-222222222222',
          ),
        },

        {
          joinDate: datefns.parseISO('2024-01-01T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('Player3'),
          logType: 'playerJoin' as const,
          playerId: OptionalVRChatPlayerIdSchema.parse(
            'usr_33333333-3333-3333-3333-333333333333',
          ),
        },
        {
          joinDate: datefns.parseISO('2024-01-02T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('Player3'),
          logType: 'playerJoin' as const,
          playerId: OptionalVRChatPlayerIdSchema.parse(
            'usr_33333333-3333-3333-3333-333333333333',
          ),
        },
        {
          joinDate: datefns.parseISO('2024-01-03T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('Player3'),
          logType: 'playerJoin' as const,
          playerId: OptionalVRChatPlayerIdSchema.parse(
            'usr_33333333-3333-3333-3333-333333333333',
          ),
        },

        {
          joinDate: datefns.parseISO('2024-01-01T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('Player4'),
          logType: 'playerJoin' as const,
          playerId: OptionalVRChatPlayerIdSchema.parse(
            'usr_44444444-4444-4444-4444-444444444444',
          ),
        },
        {
          joinDate: datefns.parseISO('2024-01-02T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('Player4'),
          logType: 'playerJoin' as const,
          playerId: OptionalVRChatPlayerIdSchema.parse(
            'usr_44444444-4444-4444-4444-444444444444',
          ),
        },

        {
          joinDate: datefns.parseISO('2024-01-01T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('Player5'),
          logType: 'playerJoin' as const,
          playerId: OptionalVRChatPlayerIdSchema.parse(
            'usr_55555555-5555-5555-5555-555555555555',
          ),
        },
      ];

      await service.createVRChatPlayerJoinLogModel(playerJoinLogList);

      // 上位2名のみ取得
      const resultWrapper = await getFrequentPlayerNames(2);
      const result = resultWrapper._unsafeUnwrap();

      expect(result).toHaveLength(2);
      expect(result).toEqual(['Player1', 'Player2']);
    });

    it('プレイヤーログが存在しない場合は空配列を返す', async () => {
      const resultWrapper = await getFrequentPlayerNames(5);
      const result = resultWrapper._unsafeUnwrap();

      expect(result).toEqual([]);
    });

    it('同じ頻度のプレイヤーがいる場合でも正しく処理される', async () => {
      // 同じ頻度のプレイヤーデータを作成
      const playerJoinLogList = [
        {
          joinDate: datefns.parseISO('2024-01-01T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('PlayerA'),
          logType: 'playerJoin' as const,
          playerId: OptionalVRChatPlayerIdSchema.parse(
            'usr_12345678-1234-1234-1234-123456789abc',
          ),
        },
        {
          joinDate: datefns.parseISO('2024-01-02T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('PlayerA'),
          logType: 'playerJoin' as const,
          playerId: OptionalVRChatPlayerIdSchema.parse(
            'usr_12345678-1234-1234-1234-123456789abc',
          ),
        },

        {
          joinDate: datefns.parseISO('2024-01-01T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('PlayerB'),
          logType: 'playerJoin' as const,
          playerId: OptionalVRChatPlayerIdSchema.parse(
            'usr_87654321-4321-4321-4321-abc123456789',
          ),
        },
        {
          joinDate: datefns.parseISO('2024-01-02T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('PlayerB'),
          logType: 'playerJoin' as const,
          playerId: OptionalVRChatPlayerIdSchema.parse(
            'usr_87654321-4321-4321-4321-abc123456789',
          ),
        },

        {
          joinDate: datefns.parseISO('2024-01-01T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('PlayerC'),
          logType: 'playerJoin' as const,
          playerId: OptionalVRChatPlayerIdSchema.parse(
            'usr_abcdef12-3456-7890-abcd-ef1234567890',
          ),
        },
      ];

      await service.createVRChatPlayerJoinLogModel(playerJoinLogList);

      const resultWrapper = await getFrequentPlayerNames(3);
      const result = resultWrapper._unsafeUnwrap();

      expect(result).toHaveLength(3);
      expect(result).toContain('PlayerA');
      expect(result).toContain('PlayerB');
      expect(result).toContain('PlayerC');
      // PlayerAとPlayerBは同じ頻度なので順序は不定だが、両方含まれている
      expect(result.slice(0, 2)).toEqual(
        expect.arrayContaining(['PlayerA', 'PlayerB']),
      );
      expect(result[2]).toBe('PlayerC');
    });

    it('重複したプレイヤー名でも正しく集計される', async () => {
      // 異なる時刻での複数参加をテスト
      const playerJoinLogList = [
        {
          joinDate: datefns.parseISO('2024-01-01T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('FrequentPlayer'),
          logType: 'playerJoin' as const,
          playerId: OptionalVRChatPlayerIdSchema.parse(
            'usr_11111111-1111-1111-1111-111111111111',
          ),
        },
        {
          joinDate: datefns.parseISO('2024-01-02T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('FrequentPlayer'),
          logType: 'playerJoin' as const,
          playerId: OptionalVRChatPlayerIdSchema.parse(
            'usr_11111111-1111-1111-1111-111111111111',
          ),
        },
        {
          joinDate: datefns.parseISO('2024-01-03T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('FrequentPlayer'),
          logType: 'playerJoin' as const,
          playerId: OptionalVRChatPlayerIdSchema.parse(
            'usr_11111111-1111-1111-1111-111111111111',
          ),
        },
        {
          joinDate: datefns.parseISO('2024-01-01T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('SinglePlayer'),
          logType: 'playerJoin' as const,
          playerId: OptionalVRChatPlayerIdSchema.parse(
            'usr_22222222-2222-2222-2222-222222222222',
          ),
        },
      ];

      const createdEntries =
        await service.createVRChatPlayerJoinLogModel(playerJoinLogList);
      expect(createdEntries).toHaveLength(4); // 全て異なる時刻なので4つ作成される

      const resultWrapper = await getFrequentPlayerNames(2);
      const result = resultWrapper._unsafeUnwrap();

      // FrequentPlayerは3回、SinglePlayerは1回なので、この順序で返される
      expect(result).toEqual(['FrequentPlayer', 'SinglePlayer']);
    });
  });
});
