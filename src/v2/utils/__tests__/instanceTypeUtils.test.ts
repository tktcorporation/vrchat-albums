import { describe, expect, it } from 'vitest';
import {
  getInstanceType,
  getInstanceTypeLabel,
  getInstanceTypeWithConfidence,
  shouldShowInstanceTypeBadge,
} from '../instanceTypeUtils';

describe('instanceTypeUtils', () => {
  describe('getInstanceTypeWithConfidence', () => {
    it('nullの場合は低信頼度でnullを返す', () => {
      const result = getInstanceTypeWithConfidence(null);
      expect(result).toEqual({ type: null, confidence: 'low' });
    });

    it('空文字の場合は低信頼度でnullを返す', () => {
      const result = getInstanceTypeWithConfidence('');
      expect(result).toEqual({ type: null, confidence: 'low' });
    });

    it('~がないインスタンスIDは高信頼度でpublicを返す', () => {
      const result = getInstanceTypeWithConfidence('12345');
      expect(result).toEqual({ type: 'public', confidence: 'high' });
    });

    it('~以降が存在しない場合は低信頼度でnullを返す', () => {
      const result = getInstanceTypeWithConfidence('12345~');
      expect(result).toEqual({ type: null, confidence: 'low' });
    });

    describe('既知のプライベートインスタンスパターン（高信頼度）', () => {
      it('friendsインスタンスを高信頼度で判定する', () => {
        const result = getInstanceTypeWithConfidence(
          '12345~friends(usr_12345678-1234-1234-1234-123456789abc)',
        );
        expect(result).toEqual({ type: 'friends', confidence: 'high' });
      });

      it('friends+インスタンスを高信頼度で判定する', () => {
        const result = getInstanceTypeWithConfidence(
          '12345~hidden(usr_12345678-1234-1234-1234-123456789abc)',
        );
        expect(result).toEqual({ type: 'friends+', confidence: 'high' });
      });

      it('inviteインスタンスを高信頼度で判定する', () => {
        const result = getInstanceTypeWithConfidence(
          '12345~private(usr_12345678-1234-1234-1234-123456789abc)',
        );
        expect(result).toEqual({ type: 'invite', confidence: 'high' });
      });

      it('groupインスタンスを高信頼度で判定する', () => {
        const result = getInstanceTypeWithConfidence(
          '12345~group(grp_12345678-1234-1234-1234-123456789abc)',
        );
        expect(result).toEqual({ type: 'group', confidence: 'high' });
      });

      it('group-publicインスタンスを高信頼度で判定する', () => {
        const result = getInstanceTypeWithConfidence(
          '12345~groupPublic(grp_12345678-1234-1234-1234-123456789abc)',
        );
        expect(result).toEqual({ type: 'group-public', confidence: 'high' });
      });
    });

    describe('リージョン情報パターン（中信頼度）', () => {
      it('既知の2文字のリージョンコードを中信頼度でpublicと判定する', () => {
        const result = getInstanceTypeWithConfidence('12345~jp');
        expect(result).toEqual({ type: 'public', confidence: 'medium' });
      });

      it('既知の3文字のリージョンコードを中信頼度でpublicと判定する', () => {
        const result = getInstanceTypeWithConfidence('12345~usw');
        expect(result).toEqual({ type: 'public', confidence: 'medium' });
      });

      it('既知のリージョンコードとパラメータを中信頼度でpublicと判定する', () => {
        const result = getInstanceTypeWithConfidence('12345~us(e)');
        expect(result).toEqual({ type: 'public', confidence: 'medium' });
      });

      it('数字を含むリージョンパラメータを中信頼度でpublicと判定する', () => {
        const result = getInstanceTypeWithConfidence('12345~jp(1234)');
        expect(result).toEqual({ type: 'public', confidence: 'medium' });
      });

      it('未知のリージョンコードは低信頼度でpublicと判定する', () => {
        const result = getInstanceTypeWithConfidence('12345~xy');
        expect(result).toEqual({ type: 'public', confidence: 'low' });
      });
    });

    describe('不明なパターン（低信頼度）', () => {
      it('不明なタイプの場合は低信頼度でunknownを返す', () => {
        const result = getInstanceTypeWithConfidence('12345~something');
        expect(result).toEqual({ type: 'unknown', confidence: 'low' });
      });

      it('長いリージョンコードは低信頼度でunknownを返す', () => {
        const result = getInstanceTypeWithConfidence('12345~toolong');
        expect(result).toEqual({ type: 'unknown', confidence: 'low' });
      });

      it('無効なリージョンパラメータは低信頼度でunknownを返す', () => {
        const result = getInstanceTypeWithConfidence('12345~us(invalid!)');
        expect(result).toEqual({ type: 'unknown', confidence: 'low' });
      });
    });
  });

  describe('shouldShowInstanceTypeBadge', () => {
    it('nullの場合はfalseを返す', () => {
      expect(shouldShowInstanceTypeBadge(null)).toBe(false);
    });

    it('高信頼度の場合はtrueを返す', () => {
      expect(shouldShowInstanceTypeBadge('12345')).toBe(true);
      expect(shouldShowInstanceTypeBadge('12345~friends(usr_123)')).toBe(true);
    });

    it('中信頼度の場合はtrueを返す', () => {
      expect(shouldShowInstanceTypeBadge('12345~jp')).toBe(true);
      expect(shouldShowInstanceTypeBadge('12345~us(e)')).toBe(true);
    });

    it('低信頼度の場合はfalseを返す', () => {
      expect(shouldShowInstanceTypeBadge('12345~something')).toBe(false);
      expect(shouldShowInstanceTypeBadge('12345~toolong')).toBe(false);
      expect(shouldShowInstanceTypeBadge('12345~xy')).toBe(false); // 未知のリージョンコード
    });
  });

  describe('getInstanceType（後方互換性）', () => {
    it('従来の動作を維持している', () => {
      expect(getInstanceType('12345')).toBe('public');
      expect(getInstanceType('12345~friends(usr_123)')).toBe('friends');
      expect(getInstanceType('12345~jp')).toBe('public');
      expect(getInstanceType('12345~something')).toBe('unknown');
      expect(getInstanceType(null)).toBe(null);
    });
  });

  describe('getInstanceTypeLabel', () => {
    it('各インスタンスタイプに対応する正しいラベルを返す', () => {
      expect(getInstanceTypeLabel('12345')).toBe('Public');
      expect(getInstanceTypeLabel('12345~friends(usr_123)')).toBe('Friends');
      expect(getInstanceTypeLabel('12345~hidden(usr_123)')).toBe('Friends+');
      expect(getInstanceTypeLabel('12345~private(usr_123)')).toBe('Invite');
      expect(getInstanceTypeLabel('12345~group(grp_123)')).toBe('Group');
      expect(getInstanceTypeLabel('12345~groupPublic(grp_123)')).toBe(
        'Group Public',
      );
      expect(getInstanceTypeLabel('12345~something')).toBe('Unknown');
      expect(getInstanceTypeLabel(null)).toBe('');
    });
  });

  describe('エッジケース', () => {
    it('空の~セクションは低信頼度でnullを返す', () => {
      const result = getInstanceTypeWithConfidence('12345~');
      expect(result).toEqual({ type: null, confidence: 'low' });
    });

    it('複数の~が含まれる場合は最初の~以降を解析する', () => {
      const result = getInstanceTypeWithConfidence(
        '12345~friends(usr_123)~extra',
      );
      expect(result).toEqual({ type: 'friends', confidence: 'high' });
    });

    it('大文字のリージョンコードは低信頼度でunknownを返す', () => {
      const result = getInstanceTypeWithConfidence('12345~JP');
      expect(result).toEqual({ type: 'unknown', confidence: 'low' });
    });

    it('極端に長いインスタンスIDは低信頼度でnullを返す', () => {
      const longInstanceId = 'a'.repeat(1001);
      const result = getInstanceTypeWithConfidence(longInstanceId);
      expect(result).toEqual({ type: null, confidence: 'low' });
    });

    it('最大長ギリギリのインスタンスIDは正常に処理される', () => {
      const maxLengthInstanceId = `${'a'.repeat(999)}b`;
      const result = getInstanceTypeWithConfidence(maxLengthInstanceId);
      expect(result).toEqual({ type: 'public', confidence: 'high' });
    });

    it('4文字以上のリージョンコードは低信頼度でunknownを返す', () => {
      const result = getInstanceTypeWithConfidence('12345~toolong');
      expect(result).toEqual({ type: 'unknown', confidence: 'low' });
    });

    it('パターンに一致するが未知のリージョンコードは低信頼度でpublicを返す', () => {
      const result = getInstanceTypeWithConfidence('12345~xy(123)');
      expect(result).toEqual({ type: 'public', confidence: 'low' });
    });
  });
});
