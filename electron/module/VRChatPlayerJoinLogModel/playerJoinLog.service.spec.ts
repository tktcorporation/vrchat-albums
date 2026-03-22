import * as datefns from 'date-fns';
import { Cause, Effect, Exit, Option } from 'effect';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as client from '../../lib/sequelize';
import { VRChatPlayerNameSchema } from '../vrchatLog/model';
import * as service from './playerJoinLog.service';

describe('VRChatPlayerJoinLogModel', () => {
  describe('createVRChatPlayerJoinLogModel', () => {
    beforeAll(async () => {
      await client.__initTestRDBClient();
    }, 10000);
    beforeEach(async () => {
      await client.__forceSyncRDBClient();
    });
    afterAll(async () => {
      await client.__cleanupTestRDBClient();
    });
    it('should create playerJoinLog', async () => {
      const playerJoinLogList = [
        {
          joinDate: datefns.parseISO('2021-01-01T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('player1'),
          logType: 'playerJoin' as const,
          playerId: null,
        },
        {
          joinDate: datefns.parseISO('2021-01-02T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('player2'),
          logType: 'playerJoin' as const,
          playerId: null,
        },
      ];
      await service.createVRChatPlayerJoinLogModel(playerJoinLogList);
      const logs = await Effect.runPromise(
        service.getVRChatPlayerJoinLogListByJoinDateTime({
          startJoinDateTime: datefns.parseISO('2021-01-01T00:00:00Z'),
          endJoinDateTime: datefns.parseISO('2021-01-03T00:00:00Z'),
        }),
      );

      expect(
        logs.map((log) => ({
          joinDateTime: log.joinDateTime,
          playerName: log.playerName,
        })),
      ).toEqual([
        {
          joinDateTime: datefns.parseISO('2021-01-01T00:00:00Z'),
          playerName: 'player1',
        },
        {
          joinDateTime: datefns.parseISO('2021-01-02T00:00:00Z'),
          playerName: 'player2',
        },
      ]);
    });

    it('should return error for invalid date range', async () => {
      const exit = await Effect.runPromiseExit(
        service.getVRChatPlayerJoinLogListByJoinDateTime({
          startJoinDateTime: datefns.parseISO('2021-01-03T00:00:00Z'),
          endJoinDateTime: datefns.parseISO('2021-01-01T00:00:00Z'), // 開始日時が終了日時より後
        }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failOpt = Cause.failureOption(exit.cause);
        expect(Option.isSome(failOpt)).toBe(true);
        if (Option.isSome(failOpt)) {
          expect(failOpt.value._tag).toBe('PlayerJoinLogInvalidDateRange');
        }
      }
    });

    it('should handle create duplicated playerJoinLog', async () => {
      const playerJoinLogList = [
        {
          joinDate: datefns.parseISO('2021-01-03T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('player1'),
          logType: 'playerJoin' as const,
          playerId: null,
        },
        {
          joinDate: datefns.parseISO('2021-01-03T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('player1'),
          logType: 'playerJoin' as const,
          playerId: null,
        },
        {
          joinDate: datefns.parseISO('2021-01-03T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('player2'),
          logType: 'playerJoin' as const,
          playerId: null,
        },
        {
          joinDate: datefns.parseISO('2021-01-03T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('player1'),
          logType: 'playerJoin' as const,
          playerId: null,
        },
        {
          joinDate: datefns.parseISO('2021-01-03T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('player2'),
          logType: 'playerJoin' as const,
          playerId: null,
        },
      ];
      await service.createVRChatPlayerJoinLogModel(playerJoinLogList);
      const logs = await Effect.runPromise(
        service.getVRChatPlayerJoinLogListByJoinDateTime({
          startJoinDateTime: datefns.parseISO('2021-01-01T00:00:00Z'),
          endJoinDateTime: datefns.parseISO('2021-01-04T00:00:00Z'),
        }),
      );

      expect(
        logs.map((log) => ({
          joinDateTime: log.joinDateTime,
          playerName: log.playerName,
        })),
      ).toEqual([
        {
          joinDateTime: datefns.parseISO('2021-01-03T00:00:00Z'),
          playerName: 'player1',
        },
        {
          joinDateTime: datefns.parseISO('2021-01-03T00:00:00Z'),
          playerName: 'player2',
        },
      ]);
    });
    it('should handle create duplicated playerJoinLog call twice', async () => {
      const playerJoinLogList = [
        {
          joinDate: datefns.parseISO('2021-01-01T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('player1'),
          logType: 'playerJoin' as const,
          playerId: null,
        },
        {
          joinDate: datefns.parseISO('2021-01-01T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('player1'),
          logType: 'playerJoin' as const,
          playerId: null,
        },
      ];
      const result1 =
        await service.createVRChatPlayerJoinLogModel(playerJoinLogList);
      expect(
        result1.map((log) => ({
          joinDateTime: log.joinDateTime,
          playerName: log.playerName,
        })),
      ).toEqual([
        {
          joinDateTime: datefns.parseISO('2021-01-01T00:00:00Z'),
          playerName: 'player1',
        },
      ]);
      const result2 =
        await service.createVRChatPlayerJoinLogModel(playerJoinLogList);
      expect(
        result2.map((log) => ({
          joinDateTime: log.joinDateTime,
          playerName: log.playerName,
        })),
      ).toEqual([]);

      const logs = await Effect.runPromise(
        service.getVRChatPlayerJoinLogListByJoinDateTime({
          startJoinDateTime: datefns.parseISO('2021-01-01T00:00:00Z'),
          endJoinDateTime: datefns.parseISO('2021-01-04T00:00:00Z'),
        }),
      );

      expect(
        logs.map((log) => ({
          joinDateTime: log.joinDateTime,
          playerName: log.playerName,
        })),
      ).toEqual([
        {
          joinDateTime: datefns.parseISO('2021-01-01T00:00:00Z'),
          playerName: 'player1',
        },
      ]);
    });

    it('should return latest detected date', async () => {
      const playerJoinLogList = [
        {
          joinDate: datefns.parseISO('2021-01-01T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('player1'),
          logType: 'playerJoin' as const,
          playerId: null,
        },
        {
          joinDate: datefns.parseISO('2021-01-02T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('player2'),
          logType: 'playerJoin' as const,
          playerId: null,
        },
      ];
      await service.createVRChatPlayerJoinLogModel(playerJoinLogList);

      const value = await Effect.runPromise(service.getLatestDetectedDate());

      // 最新の日時（2021-01-02）が返されることを確認
      expect(value).toBe('2021-01-02T00:00:00.000Z');
    });

    it('should find latest player join log', async () => {
      const playerJoinLogList = [
        {
          joinDate: datefns.parseISO('2021-01-01T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('player1'),
          logType: 'playerJoin' as const,
          playerId: null,
        },
        {
          joinDate: datefns.parseISO('2021-01-02T00:00:00Z'),
          playerName: VRChatPlayerNameSchema.parse('player2'),
          logType: 'playerJoin' as const,
          playerId: null,
        },
      ];
      await service.createVRChatPlayerJoinLogModel(playerJoinLogList);

      const value = await Effect.runPromise(service.findLatestPlayerJoinLog());

      expect(value?.playerName).toBe('player2');
      expect(value?.joinDateTime).toEqual(
        datefns.parseISO('2021-01-02T00:00:00Z'),
      );
    });
  });
});
