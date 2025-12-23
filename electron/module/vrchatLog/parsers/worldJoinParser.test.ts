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

      expect(result).not.toBeNull();
      expect(result?.logType).toBe('worldJoin');
      expect(result?.worldId).toBe('wrld_12345678-1234-1234-1234-123456789abc');
      expect(result?.worldInstanceId.value).toBe('12345');
      expect(result?.worldName).toBe('Test World');
      expect(result?.joinDate).toEqual(new Date('2023-10-08T15:30:45'));
    });

    it('ワールド名が見つからない場合はエラーを投げる', () => {
      const logLines = [
        VRChatLogLineSchema.parse(
          '2023.10.08 15:30:45 Log        -  [Behaviour] Joining wrld_12345678-1234-1234-1234-123456789abc:12345',
        ),
      ];

      expect(() => extractWorldJoinInfoFromLogs(logLines, 0)).toThrow(
        'Failed to extract world name from the subsequent log entries',
      );
    });

    it('無効なワールドIDの場合はエラーを投げる', () => {
      const logLines = [
        VRChatLogLineSchema.parse(
          '2023.10.08 15:30:45 Log        -  [Behaviour] Joining wrld_1234567-1234-1234-1234-123456789abc:12345',
        ),
        VRChatLogLineSchema.parse(
          '2023.10.08 15:30:46 Log        -  [Behaviour] Joining or Creating Room: Test World',
        ),
      ];

      expect(() => extractWorldJoinInfoFromLogs(logLines, 0)).toThrow(
        'Invalid VRChat World ID format. Expected: wrld_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      );
    });

    it('ログ形式が不正な場合はnullを返す', () => {
      const logLines = [
        VRChatLogLineSchema.parse('2023.10.08 15:30:45 Log - Invalid format'),
      ];

      const result = extractWorldJoinInfoFromLogs(logLines, 0);
      expect(result).toBeNull();
    });
  });
});
