import * as datefns from 'date-fns';
import { describe, expect, it } from 'vitest';

import { parseLogDateTime } from './baseParser';

describe('タイムゾーン処理の検証', () => {
  it('parseLogDateTime は local time として解釈する', () => {
    // VRChatログの形式: 2024.01.01 15:30:45
    const dateStr = '2024.01.01';
    const timeStr = '15:30:45';

    const result = parseLogDateTime(dateStr, timeStr);

    // 結果がローカルタイムゾーンで解釈されているか確認
    expect(result.getFullYear()).toBe(2024);
    expect(result.getMonth()).toBe(0); // 0-indexed
    expect(result.getDate()).toBe(1);
    expect(result.getHours()).toBe(15);
    expect(result.getMinutes()).toBe(30);
    expect(result.getSeconds()).toBe(45);

    // 同じ時刻のDateオブジェクトと比較
    const expectedLocal = new Date(2024, 0, 1, 15, 30, 45);
    expect(result.getTime()).toBe(expectedLocal.getTime());
  });

  it('異なるタイムゾーンの同じ瞬間が同じgetTime()値を持つ', () => {
    // 日本時間の10:00 = UTC 01:00
    const jstTime = new Date('2024-01-01T10:00:00+09:00');
    const utcTime = new Date('2024-01-01T01:00:00Z');

    // 同じ瞬間を表しているので、getTime()の値は同じになる
    expect(jstTime.getTime()).toBe(utcTime.getTime());
  });

  it('写真ファイル名の日時パースもローカルタイムとして処理', () => {
    // 写真ファイル名の形式: VRChat_2024-01-01_15-30-45.123_...
    const photoDateTime = '2024-01-01_15-30-45.123';

    const result = datefns.parse(
      photoDateTime,
      'yyyy-MM-dd_HH-mm-ss.SSS',
      new Date(),
    );

    // ローカルタイムとして解釈されているか確認
    expect(result.getFullYear()).toBe(2024);
    expect(result.getMonth()).toBe(0);
    expect(result.getDate()).toBe(1);
    expect(result.getHours()).toBe(15);
    expect(result.getMinutes()).toBe(30);
    expect(result.getSeconds()).toBe(45);
    expect(result.getMilliseconds()).toBe(123);
  });

  it('ログ時刻と写真時刻の比較が正しく動作する', () => {
    // 同じローカル時刻で作成されたログと写真
    const logTime = parseLogDateTime('2024.01.01', '15:30:45');
    const photoTime = datefns.parse(
      '2024-01-01_15-30-50.000', // 5秒後
      'yyyy-MM-dd_HH-mm-ss.SSS',
      new Date(),
    );

    // 写真の方が後に撮影されている
    expect(photoTime.getTime()).toBeGreaterThan(logTime.getTime());

    // 差が5秒であることを確認
    const diffInSeconds = (photoTime.getTime() - logTime.getTime()) / 1000;
    expect(diffInSeconds).toBe(5);
  });

  it('タイムゾーンが異なる環境でも一貫した結果が得られる', () => {
    // 特定の瞬間を異なるタイムゾーン表現で作成
    const moment1 = new Date('2024-01-01T10:00:00+09:00'); // JST
    const moment2 = new Date('2024-01-01T01:00:00+00:00'); // UTC
    const moment3 = new Date('2023-12-31T20:00:00-05:00'); // EST

    // すべて同じ瞬間を表しているので、getTime()の値は同じ
    expect(moment1.getTime()).toBe(moment2.getTime());
    expect(moment2.getTime()).toBe(moment3.getTime());
  });

  it('夏時間の影響を考慮した処理', () => {
    // 夏時間の開始/終了時期での処理をテスト
    // 注意: これはローカルタイムゾーンに依存するため、
    // 実際の運用では地域設定を考慮する必要がある

    const beforeDST = new Date('2024-03-09T01:00:00'); // アメリカの夏時間開始前
    const afterDST = new Date('2024-03-10T03:00:00'); // 夏時間開始後

    // 差が26時間（25時間 + 1時間のDST調整）であることを確認
    const diffInHours =
      (afterDST.getTime() - beforeDST.getTime()) / (1000 * 60 * 60);
    expect(diffInHours).toBe(26);
  });

  it('境界ケース: 月末・年末の日時処理', () => {
    // 月をまたぐケース
    const endOfMonth = parseLogDateTime('2024.01.31', '23:59:59');
    const startOfNextMonth = parseLogDateTime('2024.02.01', '00:00:00');

    const diffInSeconds =
      (startOfNextMonth.getTime() - endOfMonth.getTime()) / 1000;
    expect(diffInSeconds).toBe(1);

    // 年をまたぐケース
    const endOfYear = parseLogDateTime('2023.12.31', '23:59:59');
    const startOfNextYear = parseLogDateTime('2024.01.01', '00:00:00');

    const diffInSecondsYear =
      (startOfNextYear.getTime() - endOfYear.getTime()) / 1000;
    expect(diffInSecondsYear).toBe(1);
  });
});
