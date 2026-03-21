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

      const result = extractWorldJoinInfoFromLogs(logLines, 0);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.logType).toBe('worldJoin');
        expect(result.value.worldId).toBe(
          'wrld_12345678-1234-1234-1234-123456789abc',
        );
        expect(result.value.worldInstanceId.value).toBe('12345');
        expect(result.value.worldName).toBe('Test World');
        expect(result.value.joinDate).toEqual(new Date('2023-10-08T15:30:45'));
      }
    });

    it('ワールド名が見つからない場合はエラーを返す', () => {
      const logLines = [
        VRChatLogLineSchema.parse(
          '2023.10.08 15:30:45 Log        -  [Behaviour] Joining wrld_12345678-1234-1234-1234-123456789abc:12345',
        ),
      ];

      const result = extractWorldJoinInfoFromLogs(logLines, 0);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe('WORLD_NAME_NOT_FOUND');
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

      const result = extractWorldJoinInfoFromLogs(logLines, 0);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe('INVALID_WORLD_ID');
      }
    });

    it('ログ形式が不正な場合はLOG_FORMAT_MISMATCHエラーを返す', () => {
      const logLines = [
        VRChatLogLineSchema.parse('2023.10.08 15:30:45 Log - Invalid format'),
      ];

      const result = extractWorldJoinInfoFromLogs(logLines, 0);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe('LOG_FORMAT_MISMATCH');
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

      const result = extractWorldJoinInfoFromLogs(logLines, 0);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe('INVALID_INSTANCE_ID');
      }
    });

    it('インスタンスIDが不正な形式（wrld_xxx）の場合はINVALID_INSTANCE_IDエラーを返す', () => {
      // VRChat ログでワールドIDがインスタンスID位置に出現するケースを再現
      // (Sentry VRCHAT-PHOTO-ELECTRON-59 で報告されたケース)
      const logLines = [
        VRChatLogLineSchema.parse(
          '2023.10.08 15:30:45 Log        -  [Behaviour] Joining wrld_12345678-1234-1234-1234-123456789abc:wrld_5992ac87-4df8-4fb5-8a6c-e29688135aca',
        ),
        VRChatLogLineSchema.parse(
          '2023.10.08 15:30:46 Log        -  [Behaviour] Joining or Creating Room: Test World',
        ),
      ];

      const result = extractWorldJoinInfoFromLogs(logLines, 0);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe('INVALID_INSTANCE_ID');
        if (result.error.type === 'INVALID_INSTANCE_ID') {
          expect(result.error.instanceId).toBe(
            'wrld_5992ac87-4df8-4fb5-8a6c-e29688135aca',
          );
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

      const result = extractWorldJoinInfoFromLogs(logLines, 0);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe('INVALID_INSTANCE_ID');
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

      const result = extractWorldJoinInfoFromLogs(logLines, 0);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.worldInstanceId.value).toBe('04307~region(jp)');
      }
    });
  });
});
