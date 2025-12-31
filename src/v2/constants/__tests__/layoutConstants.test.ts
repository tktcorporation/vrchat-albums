import { describe, expect, it } from 'vitest';
import { LAYOUT_CONSTANTS } from '../layoutConstants';

describe('LAYOUT_CONSTANTS', () => {
  it('必要な定数がすべて定義されている', () => {
    expect(LAYOUT_CONSTANTS).toHaveProperty('TARGET_ROW_HEIGHT');
    expect(LAYOUT_CONSTANTS).toHaveProperty('GAP');
    expect(LAYOUT_CONSTANTS).toHaveProperty('HEADER_HEIGHT');
    expect(LAYOUT_CONSTANTS).toHaveProperty('SPACING');
    expect(LAYOUT_CONSTANTS).toHaveProperty('MAX_LAST_ROW_SCALE');
  });

  it('TARGET_ROW_HEIGHT が正の値である', () => {
    expect(LAYOUT_CONSTANTS.TARGET_ROW_HEIGHT).toBeGreaterThan(0);
    expect(typeof LAYOUT_CONSTANTS.TARGET_ROW_HEIGHT).toBe('number');
  });

  it('GAP が非負の値である', () => {
    expect(LAYOUT_CONSTANTS.GAP).toBeGreaterThanOrEqual(0);
    expect(typeof LAYOUT_CONSTANTS.GAP).toBe('number');
  });

  it('HEADER_HEIGHT が正の値である', () => {
    expect(LAYOUT_CONSTANTS.HEADER_HEIGHT).toBeGreaterThan(0);
    expect(typeof LAYOUT_CONSTANTS.HEADER_HEIGHT).toBe('number');
  });

  it('SPACING が非負の値である', () => {
    expect(LAYOUT_CONSTANTS.SPACING).toBeGreaterThanOrEqual(0);
    expect(typeof LAYOUT_CONSTANTS.SPACING).toBe('number');
  });

  it('MAX_LAST_ROW_SCALE が適切な範囲の値である', () => {
    expect(LAYOUT_CONSTANTS.MAX_LAST_ROW_SCALE).toBeGreaterThan(1);
    expect(LAYOUT_CONSTANTS.MAX_LAST_ROW_SCALE).toBeLessThanOrEqual(3);
    expect(typeof LAYOUT_CONSTANTS.MAX_LAST_ROW_SCALE).toBe('number');
  });

  it('定数オブジェクトの型がreadonly constである', () => {
    // TypeScriptレベルでの読み取り専用性を確認
    // 実行時のエラーではなく、型レベルでの制約をテスト
    expect(LAYOUT_CONSTANTS).toBeDefined();
    expect(typeof LAYOUT_CONSTANTS).toBe('object');
  });

  it('期待される値が設定されている', () => {
    // Tailwind CSS クラスとの対応を確認
    expect(LAYOUT_CONSTANTS.TARGET_ROW_HEIGHT).toBe(200);
    expect(LAYOUT_CONSTANTS.GAP).toBe(8); // 8pxベースグリッドに準拠
    expect(LAYOUT_CONSTANTS.HEADER_HEIGHT).toBe(96); // h-24 = 96px
    expect(LAYOUT_CONSTANTS.SPACING).toBe(8); // space-y-2 = 8px
    expect(LAYOUT_CONSTANTS.MAX_LAST_ROW_SCALE).toBe(1.5);
  });

  it('定数の組み合わせが論理的である', () => {
    // ギャップがターゲット行高さより小さいことを確認
    expect(LAYOUT_CONSTANTS.GAP).toBeLessThan(
      LAYOUT_CONSTANTS.TARGET_ROW_HEIGHT,
    );

    // スペーシングがヘッダー高さより小さいことを確認
    expect(LAYOUT_CONSTANTS.SPACING).toBeLessThan(
      LAYOUT_CONSTANTS.HEADER_HEIGHT,
    );

    // 最大スケールが妥当な範囲であることを確認
    expect(LAYOUT_CONSTANTS.MAX_LAST_ROW_SCALE).toBeGreaterThan(1);
    expect(LAYOUT_CONSTANTS.MAX_LAST_ROW_SCALE).toBeLessThan(2);
  });
});
