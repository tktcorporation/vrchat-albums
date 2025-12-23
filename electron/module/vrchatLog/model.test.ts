import { describe, expect, it } from 'vitest';
import {
  isValidVRChatPlayerId,
  isValidVRChatPlayerName,
  isValidVRChatWorldId,
  isValidVRChatWorldInstanceId,
  isValidVRChatWorldName,
  OptionalVRChatPlayerIdSchema,
  VRChatPlayerIdSchema,
  VRChatPlayerNameSchema,
  VRChatWorldIdSchema,
  VRChatWorldInstanceIdSchema,
  VRChatWorldNameSchema,
} from './model';

describe('VRChatログ関連のvalueObjects', () => {
  describe('VRChatPlayerId', () => {
    it('有効なプレイヤーIDでvalueObjectを作成できる', () => {
      const validId = 'usr_12345678-1234-1234-1234-123456789abc';
      const playerId = VRChatPlayerIdSchema.parse(validId);
      expect(playerId).toBe(validId);
    });

    it('無効なプレイヤーIDでエラーが発生する', () => {
      expect(() => VRChatPlayerIdSchema.parse('invalid-id')).toThrow();
      expect(() =>
        VRChatPlayerIdSchema.parse('user_12345678-1234-1234-1234-123456789abc'),
      ).toThrow();
      expect(() => VRChatPlayerIdSchema.parse('')).toThrow();
    });

    it('isValid静的メソッドが正しく動作する', () => {
      expect(
        isValidVRChatPlayerId('usr_12345678-1234-1234-1234-123456789abc'),
      ).toBe(true);
      expect(isValidVRChatPlayerId('invalid-id')).toBe(false);
    });
  });

  describe('VRChatWorldId', () => {
    it('有効なワールドIDでvalueObjectを作成できる', () => {
      const validId = 'wrld_12345678-1234-1234-1234-123456789abc';
      const worldId = VRChatWorldIdSchema.parse(validId);
      expect(worldId).toBe(validId);
    });

    it('無効なワールドIDでエラーが発生する', () => {
      expect(() => VRChatWorldIdSchema.parse('invalid-id')).toThrow();
      expect(() =>
        VRChatWorldIdSchema.parse('world_12345678-1234-1234-1234-123456789abc'),
      ).toThrow();
      expect(() => VRChatWorldIdSchema.parse('')).toThrow();
    });

    it('isValid静的メソッドが正しく動作する', () => {
      expect(
        isValidVRChatWorldId('wrld_12345678-1234-1234-1234-123456789abc'),
      ).toBe(true);
      expect(isValidVRChatWorldId('invalid-id')).toBe(false);
    });
  });

  describe('VRChatWorldInstanceId', () => {
    it('有効なインスタンスIDでvalueObjectを作成できる', () => {
      const validId = '12345';
      const instanceId = VRChatWorldInstanceIdSchema.parse(validId);
      expect(instanceId.value).toBe(validId);
    });

    it('region情報付きのインスタンスIDでvalueObjectを作成できる', () => {
      const validId = '86676~region(jp)';
      const instanceId = VRChatWorldInstanceIdSchema.parse(validId);
      expect(instanceId.value).toBe(validId);
    });

    it('16進数のインスタンスIDでvalueObjectを作成できる', () => {
      const validId = '83c39dd3c3~region(us)';
      const instanceId = VRChatWorldInstanceIdSchema.parse(validId);
      expect(instanceId.value).toBe(validId);
    });

    it('無効なインスタンスIDでエラーが発生する', () => {
      expect(() => VRChatWorldInstanceIdSchema.parse('invalid-id')).toThrow();
      expect(() => VRChatWorldInstanceIdSchema.parse('123@45')).toThrow();
      expect(() => VRChatWorldInstanceIdSchema.parse('')).toThrow();
    });

    it('isValid静的メソッドが正しく動作する', () => {
      expect(isValidVRChatWorldInstanceId('12345')).toBe(true);
      expect(isValidVRChatWorldInstanceId('86676~region(jp)')).toBe(true);
      expect(isValidVRChatWorldInstanceId('83c39dd3c3~region(us)')).toBe(true);
      expect(isValidVRChatWorldInstanceId('abc123')).toBe(true);
      expect(isValidVRChatWorldInstanceId('invalid-id')).toBe(false);
    });

    describe('getInstanceType', () => {
      it('通常のインスタンスIDはpublicを返す', () => {
        const instanceId = VRChatWorldInstanceIdSchema.parse('12345');
        expect(instanceId.getInstanceType()).toBe('public');
      });

      it('リージョン情報のみの場合はpublicを返す', () => {
        const instanceId1 = VRChatWorldInstanceIdSchema.parse('12345~jp');
        expect(instanceId1.getInstanceType()).toBe('public');

        const instanceId2 = VRChatWorldInstanceIdSchema.parse('12345~us(e)');
        expect(instanceId2.getInstanceType()).toBe('public');
      });

      it('friendsインスタンスを正しく判定する', () => {
        const instanceId = VRChatWorldInstanceIdSchema.parse(
          '12345~friends(usr_12345678-1234-1234-1234-123456789abc)',
        );
        expect(instanceId.getInstanceType()).toBe('friends');
      });

      it('friends+インスタンスを正しく判定する', () => {
        const instanceId = VRChatWorldInstanceIdSchema.parse(
          '12345~hidden(usr_12345678-1234-1234-1234-123456789abc)',
        );
        expect(instanceId.getInstanceType()).toBe('friends+');
      });

      it('inviteインスタンスを正しく判定する', () => {
        const instanceId = VRChatWorldInstanceIdSchema.parse(
          '12345~private(usr_12345678-1234-1234-1234-123456789abc)',
        );
        expect(instanceId.getInstanceType()).toBe('invite');
      });

      it('groupインスタンスを正しく判定する', () => {
        const instanceId = VRChatWorldInstanceIdSchema.parse(
          '12345~group(grp_12345678-1234-1234-1234-123456789abc)',
        );
        expect(instanceId.getInstanceType()).toBe('group');
      });

      it('group-publicインスタンスを正しく判定する', () => {
        const instanceId = VRChatWorldInstanceIdSchema.parse(
          '12345~groupPublic(grp_12345678-1234-1234-1234-123456789abc)',
        );
        expect(instanceId.getInstanceType()).toBe('group-public');
      });

      it('不明なタイプの場合はunknownを返す', () => {
        const instanceId = VRChatWorldInstanceIdSchema.parse('12345~something');
        expect(instanceId.getInstanceType()).toBe('unknown');
      });
    });

    describe('getInstanceTypeLabel', () => {
      it('インスタンスタイプの適切なラベルを返す', () => {
        expect(
          VRChatWorldInstanceIdSchema.parse('12345').getInstanceTypeLabel(),
        ).toBe('Public');
        expect(
          VRChatWorldInstanceIdSchema.parse(
            '12345~friends(usr_123)',
          ).getInstanceTypeLabel(),
        ).toBe('Friends');
        expect(
          VRChatWorldInstanceIdSchema.parse(
            '12345~hidden(usr_123)',
          ).getInstanceTypeLabel(),
        ).toBe('Friends+');
        expect(
          VRChatWorldInstanceIdSchema.parse(
            '12345~private(usr_123)',
          ).getInstanceTypeLabel(),
        ).toBe('Invite');
        expect(
          VRChatWorldInstanceIdSchema.parse(
            '12345~group(grp_123)',
          ).getInstanceTypeLabel(),
        ).toBe('Group');
        expect(
          VRChatWorldInstanceIdSchema.parse(
            '12345~groupPublic(grp_123)',
          ).getInstanceTypeLabel(),
        ).toBe('Group Public');
        expect(
          VRChatWorldInstanceIdSchema.parse(
            '12345~unknown',
          ).getInstanceTypeLabel(),
        ).toBe('Unknown');
      });
    });
  });

  describe('VRChatPlayerName', () => {
    it('有効なプレイヤー名でvalueObjectを作成できる', () => {
      const validName = 'TestPlayer';
      const playerName = VRChatPlayerNameSchema.parse(validName);
      expect(playerName).toBe(validName);
    });

    it('スペースを含むプレイヤー名でも作成できる', () => {
      const validName = 'Test Player With Spaces';
      const playerName = VRChatPlayerNameSchema.parse(validName);
      expect(playerName).toBe(validName);
    });

    it('空文字列や空白のみでエラーが発生する', () => {
      expect(() => VRChatPlayerNameSchema.parse('')).toThrow();
      expect(() => VRChatPlayerNameSchema.parse('   ')).toThrow();
    });

    it('isValid静的メソッドが正しく動作する', () => {
      expect(isValidVRChatPlayerName('TestPlayer')).toBe(true);
      expect(isValidVRChatPlayerName('Test Player With Spaces')).toBe(true);
      expect(isValidVRChatPlayerName('')).toBe(false);
      expect(isValidVRChatPlayerName('   ')).toBe(false);
    });
  });

  describe('VRChatWorldName', () => {
    it('有効なワールド名でvalueObjectを作成できる', () => {
      const validName = 'Test World';
      const worldName = VRChatWorldNameSchema.parse(validName);
      expect(worldName).toBe(validName);
    });

    it('空文字列や空白のみでエラーが発生する', () => {
      expect(() => VRChatWorldNameSchema.parse('')).toThrow();
      expect(() => VRChatWorldNameSchema.parse('   ')).toThrow();
    });

    it('isValid静的メソッドが正しく動作する', () => {
      expect(isValidVRChatWorldName('Test World')).toBe(true);
      expect(isValidVRChatWorldName('')).toBe(false);
      expect(isValidVRChatWorldName('   ')).toBe(false);
    });
  });

  describe('OptionalVRChatPlayerId', () => {
    it('nullの場合はnullを返す', () => {
      const result = OptionalVRChatPlayerIdSchema.parse(null);
      expect(result).toBeNull();
    });

    it('有効なIDの場合はvalueObjectを返す', () => {
      const validId = 'usr_12345678-1234-1234-1234-123456789abc';
      const result = OptionalVRChatPlayerIdSchema.parse(validId);
      expect(result).toBe(validId);
    });

    it('無効なIDの場合はエラーが発生する', () => {
      expect(() => OptionalVRChatPlayerIdSchema.parse('invalid-id')).toThrow();
    });
  });
});
