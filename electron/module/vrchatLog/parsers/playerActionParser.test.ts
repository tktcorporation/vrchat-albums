import { Cause, Effect, Exit, Option } from 'effect';
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

      const value = Effect.runSync(extractPlayerJoinInfoFromLog(logLine));

      expect(value.logType).toBe('playerJoin');
      expect(value.playerName).toBe('TestPlayer');
      expect(value.playerId).toBe('usr_12345678-1234-1234-1234-123456789abc');
      expect(value.joinDate).toEqual(new Date('2025-01-07T23:25:34'));
    });

    it('プレイヤーIDがないプレイヤー参加ログを処理できる', () => {
      const logLine = VRChatLogLineSchema.parse(
        '2025.01.07 23:25:34 Log        -  [Behaviour] OnPlayerJoined TestPlayer',
      );

      const value = Effect.runSync(extractPlayerJoinInfoFromLog(logLine));

      expect(value.logType).toBe('playerJoin');
      expect(value.playerName).toBe('TestPlayer');
      expect(value.playerId).toBeNull();
      expect(value.joinDate).toEqual(new Date('2025-01-07T23:25:34'));
    });

    it('空白を含むプレイヤー名を正しく処理できる', () => {
      const logLine = VRChatLogLineSchema.parse(
        '2025.01.07 23:25:34 Log        -  [Behaviour] OnPlayerJoined Test Player Name (usr_12345678-1234-1234-1234-123456789abc)',
      );

      const value = Effect.runSync(extractPlayerJoinInfoFromLog(logLine));
      expect(value.playerName).toBe('Test Player Name');
    });

    it('無効な形式の場合はエラーを返す', () => {
      const logLine = VRChatLogLineSchema.parse('Invalid log format');

      const exit = Effect.runSyncExit(extractPlayerJoinInfoFromLog(logLine));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failOpt = Cause.failureOption(exit.cause);
        expect(Option.isSome(failOpt)).toBe(true);
        if (Option.isSome(failOpt)) {
          expect(failOpt.value).toBe('LOG_FORMAT_MISMATCH');
        }
      }
    });
  });

  describe('extractPlayerLeaveInfoFromLog', () => {
    it('プレイヤー退出ログから正しい情報を抽出できる', () => {
      const logLine = VRChatLogLineSchema.parse(
        '2025.01.08 00:22:04 Log        -  [Behaviour] OnPlayerLeft TestPlayer (usr_12345678-1234-1234-1234-123456789abc)',
      );

      const value = Effect.runSync(extractPlayerLeaveInfoFromLog(logLine));

      expect(value.logType).toBe('playerLeave');
      expect(value.playerName).toBe('TestPlayer');
      expect(value.playerId).toBe('usr_12345678-1234-1234-1234-123456789abc');
      expect(value.leaveDate).toEqual(new Date('2025-01-08T00:22:04'));
    });

    it('特殊文字を含むプレイヤー名を正しく処理できる', () => {
      const logLine = VRChatLogLineSchema.parse(
        '2025.01.08 00:22:04 Log        -  [Behaviour] OnPlayerLeft プレイヤー ⁄ A (usr_12345678-1234-1234-1234-123456789abc)',
      );

      const value = Effect.runSync(extractPlayerLeaveInfoFromLog(logLine));
      expect(value.playerName).toBe('プレイヤー ⁄ A');
    });

    it('プレイヤーIDがない退出ログを処理できる', () => {
      const logLine = VRChatLogLineSchema.parse(
        '2025.01.08 00:22:04 Debug      -  [Behaviour] OnPlayerLeft TestPlayer',
      );

      const value = Effect.runSync(extractPlayerLeaveInfoFromLog(logLine));
      expect(value.playerName).toBe('TestPlayer');
      expect(value.playerId).toBeNull();
    });

    it('無効な形式の場合はエラーを返す', () => {
      const logLine = VRChatLogLineSchema.parse('Invalid log format');

      const exit = Effect.runSyncExit(extractPlayerLeaveInfoFromLog(logLine));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failOpt = Cause.failureOption(exit.cause);
        expect(Option.isSome(failOpt)).toBe(true);
        if (Option.isSome(failOpt)) {
          expect(failOpt.value).toBe('LOG_FORMAT_MISMATCH');
        }
      }
    });
  });
});
