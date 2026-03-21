import { Cause, Effect, Exit, Option } from 'effect';
import { describe, expect, it } from 'vitest';
import { VRChatLogLineSchema } from '../model';
import { extractWorldJoinInfoFromLogs } from './worldJoinParser';

describe('worldJoinParser', () => {
  describe('extractWorldJoinInfoFromLogs', () => {
    it('ワールド参加ログから正しい情報を抽出できる', () => {
      const logLines = [
        VRChatLogLineSchema.parse(
          '2023.10.08 15:30:45 Log        -  [Behaviour] Joining wrld_12345678-1234-1234-1234-123456789abc:12345',
        ),
        VRChatLogLineSchema.parse(
          '2023.10.08 15:30:46 Log        -  [Behaviour] Joining or Creating Room: Test World',
        ),
      ];

      const value = Effect.runSync(extractWorldJoinInfoFromLogs(logLines, 0));

      expect(value.logType).toBe('worldJoin');
      expect(value.worldId).toBe('wrld_12345678-1234-1234-1234-123456789abc');
      expect(value.worldInstanceId.value).toBe('12345');
      expect(value.worldName).toBe('Test World');
      expect(value.joinDate).toEqual(new Date('2023-10-08T15:30:45'));
    });

    it('ワールド名が見つからない場合はエラーを返す', () => {
      const logLines = [
        VRChatLogLineSchema.parse(
          '2023.10.08 15:30:45 Log        -  [Behaviour] Joining wrld_12345678-1234-1234-1234-123456789abc:12345',
        ),
      ];

      const exit = Effect.runSyncExit(
        extractWorldJoinInfoFromLogs(logLines, 0),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failOpt = Cause.failureOption(exit.cause);
        expect(Option.isSome(failOpt)).toBe(true);
        if (Option.isSome(failOpt)) {
          expect(failOpt.value.type).toBe('WORLD_NAME_NOT_FOUND');
        }
      }
    });

    it('無効なワールドIDの場合はエラーを返す', () => {
      const logLines = [
        VRChatLogLineSchema.parse(
          '2023.10.08 15:30:45 Log        -  [Behaviour] Joining wrld_1234567-1234-1234-1234-123456789abc:12345',
        ),
        VRChatLogLineSchema.parse(
          '2023.10.08 15:30:46 Log        -  [Behaviour] Joining or Creating Room: Test World',
        ),
      ];

      const exit = Effect.runSyncExit(
        extractWorldJoinInfoFromLogs(logLines, 0),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failOpt = Cause.failureOption(exit.cause);
        expect(Option.isSome(failOpt)).toBe(true);
        if (Option.isSome(failOpt)) {
          expect(failOpt.value.type).toBe('INVALID_WORLD_ID');
        }
      }
    });

    it('ログ形式が不正な場合はLOG_FORMAT_MISMATCHエラーを返す', () => {
      const logLines = [
        VRChatLogLineSchema.parse('2023.10.08 15:30:45 Log - Invalid format'),
      ];

      const exit = Effect.runSyncExit(
        extractWorldJoinInfoFromLogs(logLines, 0),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failOpt = Cause.failureOption(exit.cause);
        expect(Option.isSome(failOpt)).toBe(true);
        if (Option.isSome(failOpt)) {
          expect(failOpt.value.type).toBe('LOG_FORMAT_MISMATCH');
        }
      }
    });

    it('インスタンスIDがないワールドIDのみの場合はINVALID_INSTANCE_IDエラーを返す', () => {
      const logLines = [
        VRChatLogLineSchema.parse(
          '2023.10.08 15:30:45 Log        -  [Behaviour] Joining wrld_12345678-1234-1234-1234-123456789abc',
        ),
        VRChatLogLineSchema.parse(
          '2023.10.08 15:30:46 Log        -  [Behaviour] Joining or Creating Room: Test World',
        ),
      ];

      const exit = Effect.runSyncExit(
        extractWorldJoinInfoFromLogs(logLines, 0),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failOpt = Cause.failureOption(exit.cause);
        expect(Option.isSome(failOpt)).toBe(true);
        if (Option.isSome(failOpt)) {
          expect(failOpt.value.type).toBe('INVALID_INSTANCE_ID');
        }
      }
    });

    it('インスタンスIDが不正な形式（wrld_xxx）の場合はINVALID_INSTANCE_IDエラーを返す', () => {
      const logLines = [
        VRChatLogLineSchema.parse(
          '2023.10.08 15:30:45 Log        -  [Behaviour] Joining wrld_12345678-1234-1234-1234-123456789abc:wrld_5992ac87-4df8-4fb5-8a6c-e29688135aca',
        ),
        VRChatLogLineSchema.parse(
          '2023.10.08 15:30:46 Log        -  [Behaviour] Joining or Creating Room: Test World',
        ),
      ];

      const exit = Effect.runSyncExit(
        extractWorldJoinInfoFromLogs(logLines, 0),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failOpt = Cause.failureOption(exit.cause);
        expect(Option.isSome(failOpt)).toBe(true);
        if (Option.isSome(failOpt)) {
          expect(failOpt.value.type).toBe('INVALID_INSTANCE_ID');
          if (failOpt.value.type === 'INVALID_INSTANCE_ID') {
            expect(failOpt.value.instanceId).toBe(
              'wrld_5992ac87-4df8-4fb5-8a6c-e29688135aca',
            );
          }
        }
      }
    });

    it('コロンの後にインスタンスIDが空の場合はINVALID_INSTANCE_IDエラーを返す', () => {
      const logLines = [
        VRChatLogLineSchema.parse(
          '2023.10.08 15:30:45 Log        -  [Behaviour] Joining wrld_12345678-1234-1234-1234-123456789abc:',
        ),
        VRChatLogLineSchema.parse(
          '2023.10.08 15:30:46 Log        -  [Behaviour] Joining or Creating Room: Test World',
        ),
      ];

      const exit = Effect.runSyncExit(
        extractWorldJoinInfoFromLogs(logLines, 0),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failOpt = Cause.failureOption(exit.cause);
        expect(Option.isSome(failOpt)).toBe(true);
        if (Option.isSome(failOpt)) {
          expect(failOpt.value.type).toBe('INVALID_INSTANCE_ID');
        }
      }
    });

    it('リージョン付きインスタンスIDを正しくパースできる', () => {
      const logLines = [
        VRChatLogLineSchema.parse(
          '2023.10.08 15:30:45 Log        -  [Behaviour] Joining wrld_12345678-1234-1234-1234-123456789abc:04307~region(jp)',
        ),
        VRChatLogLineSchema.parse(
          '2023.10.08 15:30:46 Log        -  [Behaviour] Joining or Creating Room: Test World',
        ),
      ];

      const value = Effect.runSync(extractWorldJoinInfoFromLogs(logLines, 0));

      expect(value.worldInstanceId.value).toBe('04307~region(jp)');
    });
  });
});
