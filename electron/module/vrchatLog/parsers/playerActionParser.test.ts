import { describe, expect, it } from 'vitest';
import { VRChatLogLineSchema } from '../model';
import {
  extractPlayerJoinInfoFromLog,
  extractPlayerLeaveInfoFromLog,
} from './playerActionParser';

describe('playerActionParser', () => {
  describe('extractPlayerJoinInfoFromLog', () => {
    it('プレイヤー参加ログから正しい情報を抽出できる', () => {
      const logLine = VRChatLogLineSchema.parse(
        '2025.01.07 23:25:34 Log        -  [Behaviour] OnPlayerJoined TestPlayer (usr_12345678-1234-1234-1234-123456789abc)',
      );

      const result = extractPlayerJoinInfoFromLog(logLine);

      expect(result.logType).toBe('playerJoin');
      expect(result.playerName).toBe('TestPlayer');
      expect(result.playerId).toBe('usr_12345678-1234-1234-1234-123456789abc');
      expect(result.joinDate).toEqual(new Date('2025-01-07T23:25:34'));
    });

    it('プレイヤーIDがないプレイヤー参加ログを処理できる', () => {
      const logLine = VRChatLogLineSchema.parse(
        '2025.01.07 23:25:34 Log        -  [Behaviour] OnPlayerJoined TestPlayer',
      );

      const result = extractPlayerJoinInfoFromLog(logLine);

      expect(result.logType).toBe('playerJoin');
      expect(result.playerName).toBe('TestPlayer');
      expect(result.playerId).toBeNull();
      expect(result.joinDate).toEqual(new Date('2025-01-07T23:25:34'));
    });

    it('空白を含むプレイヤー名を正しく処理できる', () => {
      const logLine = VRChatLogLineSchema.parse(
        '2025.01.07 23:25:34 Log        -  [Behaviour] OnPlayerJoined Test Player Name (usr_12345678-1234-1234-1234-123456789abc)',
      );

      const result = extractPlayerJoinInfoFromLog(logLine);
      expect(result.playerName).toBe('Test Player Name');
    });

    it('無効な形式の場合はエラーを投げる', () => {
      const logLine = VRChatLogLineSchema.parse('Invalid log format');

      expect(() => extractPlayerJoinInfoFromLog(logLine)).toThrow(
        'Log line did not match the expected format',
      );
    });
  });

  describe('extractPlayerLeaveInfoFromLog', () => {
    it('プレイヤー退出ログから正しい情報を抽出できる', () => {
      const logLine = VRChatLogLineSchema.parse(
        '2025.01.08 00:22:04 Log        -  [Behaviour] OnPlayerLeft TestPlayer (usr_12345678-1234-1234-1234-123456789abc)',
      );

      const result = extractPlayerLeaveInfoFromLog(logLine);

      expect(result.logType).toBe('playerLeave');
      expect(result.playerName).toBe('TestPlayer');
      expect(result.playerId).toBe('usr_12345678-1234-1234-1234-123456789abc');
      expect(result.leaveDate).toEqual(new Date('2025-01-08T00:22:04'));
    });

    it('特殊文字を含むプレイヤー名を正しく処理できる', () => {
      const logLine = VRChatLogLineSchema.parse(
        '2025.01.08 00:22:04 Log        -  [Behaviour] OnPlayerLeft プレイヤー ⁄ A (usr_12345678-1234-1234-1234-123456789abc)',
      );

      const result = extractPlayerLeaveInfoFromLog(logLine);
      expect(result.playerName).toBe('プレイヤー ⁄ A');
    });

    it('プレイヤーIDがない退出ログを処理できる', () => {
      const logLine = VRChatLogLineSchema.parse(
        '2025.01.08 00:22:04 Debug      -  [Behaviour] OnPlayerLeft TestPlayer',
      );

      const result = extractPlayerLeaveInfoFromLog(logLine);
      expect(result.playerName).toBe('TestPlayer');
      expect(result.playerId).toBeNull();
    });

    it('無効な形式の場合はエラーを投げる', () => {
      const logLine = VRChatLogLineSchema.parse('Invalid log format');

      expect(() => extractPlayerLeaveInfoFromLog(logLine)).toThrow(
        'Log line did not match the expected format',
      );
    });
  });
});
