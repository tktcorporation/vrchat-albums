import { describe, expect, it } from 'vitest';
import { findLatestWorldJoinBefore } from './service';

/**
 * findLatestWorldJoinBefore のユニットテスト
 *
 * この関数は二分探索を使用して、ターゲット日時以下の最大の日時を見つける。
 * 写真をワールドセッションに正しく紐付けるために使用される重要な関数。
 */
describe('findLatestWorldJoinBefore', () => {
  describe('エッジケース', () => {
    it('空配列の場合はnullを返す', () => {
      const result = findLatestWorldJoinBefore([], new Date('2024-01-15'));
      expect(result).toBeNull();
    });

    it('単一要素の配列で、ターゲットが要素より小さい場合はnullを返す', () => {
      const dates = [new Date('2024-01-15')];
      const target = new Date('2024-01-10'); // 要素より前
      const result = findLatestWorldJoinBefore(dates, target);
      expect(result).toBeNull();
    });

    it('単一要素の配列で、ターゲットが要素と等しい場合はその要素を返す', () => {
      const dates = [new Date('2024-01-15T10:00:00')];
      const target = new Date('2024-01-15T10:00:00');
      const result = findLatestWorldJoinBefore(dates, target);
      expect(result?.getTime()).toBe(dates[0].getTime());
    });

    it('単一要素の配列で、ターゲットが要素より大きい場合はその要素を返す', () => {
      const dates = [new Date('2024-01-15')];
      const target = new Date('2024-01-20'); // 要素より後
      const result = findLatestWorldJoinBefore(dates, target);
      expect(result?.getTime()).toBe(dates[0].getTime());
    });
  });

  describe('境界値テスト', () => {
    it('ターゲットが配列の最小値より小さい場合はnullを返す', () => {
      const dates = [
        new Date('2024-01-10'),
        new Date('2024-01-15'),
        new Date('2024-01-20'),
      ];
      const target = new Date('2024-01-05');
      const result = findLatestWorldJoinBefore(dates, target);
      expect(result).toBeNull();
    });

    it('ターゲットが配列の最小値と等しい場合はその最小値を返す', () => {
      const dates = [
        new Date('2024-01-10T10:00:00'),
        new Date('2024-01-15T10:00:00'),
        new Date('2024-01-20T10:00:00'),
      ];
      const target = new Date('2024-01-10T10:00:00');
      const result = findLatestWorldJoinBefore(dates, target);
      expect(result?.getTime()).toBe(dates[0].getTime());
    });

    it('ターゲットが配列の最大値と等しい場合はその最大値を返す', () => {
      const dates = [
        new Date('2024-01-10T10:00:00'),
        new Date('2024-01-15T10:00:00'),
        new Date('2024-01-20T10:00:00'),
      ];
      const target = new Date('2024-01-20T10:00:00');
      const result = findLatestWorldJoinBefore(dates, target);
      expect(result?.getTime()).toBe(dates[2].getTime());
    });

    it('ターゲットが配列の最大値より大きい場合は最大値を返す', () => {
      const dates = [
        new Date('2024-01-10'),
        new Date('2024-01-15'),
        new Date('2024-01-20'),
      ];
      const target = new Date('2024-01-25');
      const result = findLatestWorldJoinBefore(dates, target);
      expect(result?.getTime()).toBe(dates[2].getTime());
    });
  });

  describe('中間値テスト', () => {
    it('ターゲットが配列の中間にある場合、ターゲット以下の最大値を返す', () => {
      const dates = [
        new Date('2024-01-10'),
        new Date('2024-01-15'),
        new Date('2024-01-20'),
      ];
      const target = new Date('2024-01-17'); // 15と20の間
      const result = findLatestWorldJoinBefore(dates, target);
      expect(result?.getTime()).toBe(dates[1].getTime()); // 2024-01-15
    });

    it('ターゲットが配列の要素と完全に一致する場合、その要素を返す', () => {
      const dates = [
        new Date('2024-01-10T10:00:00'),
        new Date('2024-01-15T10:00:00'),
        new Date('2024-01-20T10:00:00'),
      ];
      const target = new Date('2024-01-15T10:00:00');
      const result = findLatestWorldJoinBefore(dates, target);
      expect(result?.getTime()).toBe(dates[1].getTime());
    });

    it('ターゲットが最初と2番目の要素の間にある場合、最初の要素を返す', () => {
      const dates = [
        new Date('2024-01-10'),
        new Date('2024-01-15'),
        new Date('2024-01-20'),
      ];
      const target = new Date('2024-01-12'); // 10と15の間
      const result = findLatestWorldJoinBefore(dates, target);
      expect(result?.getTime()).toBe(dates[0].getTime()); // 2024-01-10
    });
  });

  describe('2要素配列のテスト', () => {
    it('2要素配列で、ターゲットが両方より小さい場合はnullを返す', () => {
      const dates = [new Date('2024-01-10'), new Date('2024-01-20')];
      const target = new Date('2024-01-05');
      const result = findLatestWorldJoinBefore(dates, target);
      expect(result).toBeNull();
    });

    it('2要素配列で、ターゲットが両方の間にある場合は最初の要素を返す', () => {
      const dates = [new Date('2024-01-10'), new Date('2024-01-20')];
      const target = new Date('2024-01-15');
      const result = findLatestWorldJoinBefore(dates, target);
      expect(result?.getTime()).toBe(dates[0].getTime());
    });

    it('2要素配列で、ターゲットが最初の要素と等しい場合はその要素を返す', () => {
      const dates = [
        new Date('2024-01-10T10:00:00'),
        new Date('2024-01-20T10:00:00'),
      ];
      const target = new Date('2024-01-10T10:00:00');
      const result = findLatestWorldJoinBefore(dates, target);
      expect(result?.getTime()).toBe(dates[0].getTime());
    });

    it('2要素配列で、ターゲットが2番目の要素と等しい場合はその要素を返す', () => {
      const dates = [
        new Date('2024-01-10T10:00:00'),
        new Date('2024-01-20T10:00:00'),
      ];
      const target = new Date('2024-01-20T10:00:00');
      const result = findLatestWorldJoinBefore(dates, target);
      expect(result?.getTime()).toBe(dates[1].getTime());
    });

    it('2要素配列で、ターゲットが両方より大きい場合は最後の要素を返す', () => {
      const dates = [new Date('2024-01-10'), new Date('2024-01-20')];
      const target = new Date('2024-01-25');
      const result = findLatestWorldJoinBefore(dates, target);
      expect(result?.getTime()).toBe(dates[1].getTime());
    });
  });

  describe('重複日時のテスト', () => {
    it('同じ日時が複数ある場合でも正しく動作する', () => {
      const dates = [
        new Date('2024-01-10T10:00:00'),
        new Date('2024-01-10T10:00:00'), // 重複
        new Date('2024-01-15T10:00:00'),
        new Date('2024-01-15T10:00:00'), // 重複
        new Date('2024-01-20T10:00:00'),
      ];
      const target = new Date('2024-01-15T10:00:00');
      const result = findLatestWorldJoinBefore(dates, target);
      // 2024-01-15 のいずれかを返す
      expect(result?.getTime()).toBe(new Date('2024-01-15T10:00:00').getTime());
    });

    it('すべて同じ日時の場合、ターゲットが同じならその日時を返す', () => {
      const sameDate = new Date('2024-01-15T10:00:00');
      const dates = [sameDate, sameDate, sameDate];
      const target = new Date('2024-01-15T10:00:00');
      const result = findLatestWorldJoinBefore(dates, target);
      expect(result?.getTime()).toBe(sameDate.getTime());
    });

    it('すべて同じ日時の場合、ターゲットがより後ならその日時を返す', () => {
      const sameDate = new Date('2024-01-15T10:00:00');
      const dates = [sameDate, sameDate, sameDate];
      const target = new Date('2024-01-20T10:00:00');
      const result = findLatestWorldJoinBefore(dates, target);
      expect(result?.getTime()).toBe(sameDate.getTime());
    });

    it('すべて同じ日時の場合、ターゲットがより前ならnullを返す', () => {
      const sameDate = new Date('2024-01-15T10:00:00');
      const dates = [sameDate, sameDate, sameDate];
      const target = new Date('2024-01-10T10:00:00');
      const result = findLatestWorldJoinBefore(dates, target);
      expect(result).toBeNull();
    });
  });

  describe('大規模配列のテスト', () => {
    it('大きな配列でも正しく動作する（パフォーマンステスト）', () => {
      // 1000個の日時を生成（1日間隔）
      const baseTime = new Date('2020-01-01').getTime();
      const dates: Date[] = [];
      for (let i = 0; i < 1000; i++) {
        dates.push(new Date(baseTime + i * 24 * 60 * 60 * 1000));
      }

      // 中間付近のターゲット
      const target = new Date(
        baseTime + 500 * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000,
      ); // 500日目の昼
      const result = findLatestWorldJoinBefore(dates, target);

      // 500日目（インデックス500）を返すはず
      expect(result?.getTime()).toBe(dates[500].getTime());
    });

    it('10000個の要素でも高速に動作する', () => {
      const baseTime = new Date('2000-01-01').getTime();
      const dates: Date[] = [];
      for (let i = 0; i < 10000; i++) {
        dates.push(new Date(baseTime + i * 60 * 60 * 1000)); // 1時間間隔
      }

      const start = performance.now();
      const target = new Date(baseTime + 5000 * 60 * 60 * 1000);
      const result = findLatestWorldJoinBefore(dates, target);
      const elapsed = performance.now() - start;

      expect(result?.getTime()).toBe(dates[5000].getTime());
      // 二分探索なので、10000要素でも1ms未満で完了するはず
      expect(elapsed).toBeLessThan(10);
    });
  });

  describe('ミリ秒精度のテスト', () => {
    it('ミリ秒レベルの差異を正しく処理する', () => {
      const dates = [
        new Date('2024-01-15T10:00:00.000'),
        new Date('2024-01-15T10:00:00.500'),
        new Date('2024-01-15T10:00:01.000'),
      ];
      const target = new Date('2024-01-15T10:00:00.750'); // 500msと1000msの間
      const result = findLatestWorldJoinBefore(dates, target);
      expect(result?.getTime()).toBe(dates[1].getTime()); // 500ms
    });

    it('1ミリ秒の差でターゲット以下の最大値を返す', () => {
      const dates = [
        new Date('2024-01-15T10:00:00.000'),
        new Date('2024-01-15T10:00:00.001'),
        new Date('2024-01-15T10:00:00.002'),
      ];
      const target = new Date('2024-01-15T10:00:00.001');
      const result = findLatestWorldJoinBefore(dates, target);
      expect(result?.getTime()).toBe(dates[1].getTime());
    });
  });
});
