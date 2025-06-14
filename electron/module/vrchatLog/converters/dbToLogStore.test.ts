import * as datefns from 'date-fns';
import { describe, expect, it } from 'vitest';
import { VRChatLogLineSchema } from '../model';
import {
  type DBLogRecord,
  type ExportOptions,
  convertPlayerJoinLogToLogLine,
  convertPlayerLeaveLogToLogLine,
  convertWorldJoinLogToLogLines,
  exportLogsToLogStore,
} from './dbToLogStore';

describe('dbToLogStore', () => {
  describe('convertWorldJoinLogToLogLines', () => {
    it('ワールド参加ログを正しいlogStore形式に変換できる', () => {
      const worldJoinLog: DBLogRecord = {
        id: 'test-id',
        worldId: 'wrld_12345678-1234-1234-1234-123456789abc',
        worldName: 'Test World',
        worldInstanceId: '12345',
        joinDateTime: new Date('2023-10-08T15:30:45'),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = convertWorldJoinLogToLogLines(worldJoinLog);

      expect(result).toHaveLength(2);
      expect(result[0].value).toBe(
        '2023.10.08 15:30:45 Log        -  [Behaviour] Joining wrld_12345678-1234-1234-1234-123456789abc:12345',
      );
      expect(result[1].value).toBe(
        '2023.10.08 15:30:45 Log        -  [Behaviour] Joining or Creating Room: Test World',
      );
    });

    it('異なる日付形式でも正しく変換できる', () => {
      const worldJoinLog: DBLogRecord = {
        id: 'test-id',
        worldId: 'wrld_87654321-4321-4321-4321-abcdefabcdef',
        worldName: 'Another World',
        worldInstanceId: '54321',
        joinDateTime: new Date('2024-01-15T09:15:30'),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = convertWorldJoinLogToLogLines(worldJoinLog);

      expect(result[0].value).toContain('2024.01.15 09:15:30');
      expect(result[0].value).toContain(
        'wrld_87654321-4321-4321-4321-abcdefabcdef:54321',
      );
      expect(result[1].value).toContain('Another World');
    });
  });

  describe('convertPlayerJoinLogToLogLine', () => {
    it('プレイヤーIDありのプレイヤー参加ログを変換できる', () => {
      const playerJoinLog = {
        id: 'test-id',
        playerName: 'TestPlayer',
        playerId: 'usr_12345678-1234-1234-1234-123456789abc',
        joinDateTime: new Date('2025-01-07T23:25:34'),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = convertPlayerJoinLogToLogLine(playerJoinLog);

      expect(result.value).toBe(
        '2025.01.07 23:25:34 Log        -  [Behaviour] OnPlayerJoined TestPlayer (usr_12345678-1234-1234-1234-123456789abc)',
      );
    });

    it('プレイヤーIDなしのプレイヤー参加ログを変換できる', () => {
      const playerJoinLog = {
        id: 'test-id',
        playerName: 'TestPlayer',
        playerId: null,
        joinDateTime: new Date('2025-01-07T23:25:34'),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = convertPlayerJoinLogToLogLine(playerJoinLog);

      expect(result.value).toBe(
        '2025.01.07 23:25:34 Log        -  [Behaviour] OnPlayerJoined TestPlayer',
      );
    });

    it('空白を含むプレイヤー名を正しく処理できる', () => {
      const playerJoinLog = {
        id: 'test-id',
        playerName: 'Test Player Name',
        playerId: 'usr_12345678-1234-1234-1234-123456789abc',
        joinDateTime: new Date('2025-01-07T23:25:34'),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = convertPlayerJoinLogToLogLine(playerJoinLog);

      expect(result.value).toContain('Test Player Name');
    });
  });

  describe('convertPlayerLeaveLogToLogLine', () => {
    it('プレイヤーIDありのプレイヤー退出ログを変換できる', () => {
      const playerLeaveLog = {
        id: 'test-id',
        playerName: 'TestPlayer',
        playerId: 'usr_12345678-1234-1234-1234-123456789abc',
        leaveDateTime: new Date('2025-01-08T00:22:04'),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = convertPlayerLeaveLogToLogLine(playerLeaveLog);

      expect(result.value).toBe(
        '2025.01.08 00:22:04 Log        -  [Behaviour] OnPlayerLeft TestPlayer (usr_12345678-1234-1234-1234-123456789abc)',
      );
    });

    it('プレイヤーIDなしのプレイヤー退出ログを変換できる', () => {
      const playerLeaveLog = {
        id: 'test-id',
        playerName: 'TestPlayer',
        playerId: null,
        leaveDateTime: new Date('2025-01-08T00:22:04'),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = convertPlayerLeaveLogToLogLine(playerLeaveLog);

      expect(result.value).toBe(
        '2025.01.08 00:22:04 Log        -  [Behaviour] OnPlayerLeft TestPlayer',
      );
    });

    it('特殊文字を含むプレイヤー名を正しく処理できる', () => {
      const playerLeaveLog = {
        id: 'test-id',
        playerName: 'プレイヤー ⁄ A',
        playerId: 'usr_12345678-1234-1234-1234-123456789abc',
        leaveDateTime: new Date('2025-01-08T00:22:04'),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = convertPlayerLeaveLogToLogLine(playerLeaveLog);

      expect(result.value).toContain('プレイヤー ⁄ A');
    });
  });

  describe('exportLogsToLogStore', () => {
    it('混合ログを時系列順でlogStore形式に変換できる', () => {
      const dbRecords = [
        {
          type: 'worldJoin' as const,
          record: {
            id: 'world-1',
            worldId: 'wrld_12345678-1234-1234-1234-123456789abc',
            worldName: 'Test World',
            worldInstanceId: '12345',
            joinDateTime: new Date('2023-10-08T15:30:45'),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
        {
          type: 'playerJoin' as const,
          record: {
            id: 'player-1',
            playerName: 'TestPlayer',
            playerId: 'usr_12345678-1234-1234-1234-123456789abc',
            joinDateTime: new Date('2023-10-08T15:31:00'),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
        {
          type: 'playerLeave' as const,
          record: {
            id: 'player-2',
            playerName: 'TestPlayer',
            playerId: 'usr_12345678-1234-1234-1234-123456789abc',
            leaveDateTime: new Date('2023-10-08T15:32:00'),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      ];

      const result = exportLogsToLogStore(dbRecords);

      expect(result).toHaveLength(4); // worldJoin=2行 + playerJoin=1行 + playerLeave=1行

      // 時系列順であることを確認
      expect(result[0].value).toContain('15:30:45');
      expect(result[0].value).toContain('Joining wrld_');
      expect(result[1].value).toContain('15:30:45');
      expect(result[1].value).toContain('Joining or Creating Room');
      expect(result[2].value).toContain('15:31:00');
      expect(result[2].value).toContain('OnPlayerJoined');
      expect(result[3].value).toContain('15:32:00');
      expect(result[3].value).toContain('OnPlayerLeft');
    });

    it('空の配列で空の結果を返す', () => {
      const result = exportLogsToLogStore([]);
      expect(result).toHaveLength(0);
    });
  });
});
