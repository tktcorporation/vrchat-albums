import { describe, expect, it } from 'vitest';
import { VRChatPhotoFileNameWithExtSchema } from '../../../valueObjects';
import { LAYOUT_CONSTANTS } from '../../constants/layoutConstants';
import type { Photo } from '../../types/photo';
import {
  estimateGroupHeight,
  GROUP_HEIGHT_CONSTANTS,
  precomputeGroupHeights,
} from '../estimateGroupHeight';
import { JustifiedLayoutCalculator } from '../justifiedLayoutCalculator';

/**
 * テスト用のモック写真データを生成
 */
const createMockPhotos = (count: number): Photo[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `photo-${i}`,
    url: `/path/photo-${i}.jpg`,
    fileNameWithExt: VRChatPhotoFileNameWithExtSchema.parse(
      'VRChat_2025-05-25_12-00-00.000_1920x1080.png',
    ),
    width: 1920,
    height: 1080,
    takenAt: new Date(),
    location: {
      joinedAt: new Date(),
    },
  }));

describe('estimateGroupHeight', () => {
  describe('キャッシュがある場合', () => {
    it('キャッシュされた高さ + GROUP_SPACING を返す', () => {
      const photos = createMockPhotos(5);
      const cachedHeight = 400;

      const result = estimateGroupHeight(photos, 1000, cachedHeight);

      expect(result.height).toBe(
        cachedHeight + GROUP_HEIGHT_CONSTANTS.GROUP_SPACING,
      );
      expect(result.source).toBe('cache');
    });

    it('キャッシュが0の場合は計算を実行する', () => {
      const photos = createMockPhotos(5);
      const cachedHeight = 0;

      const result = estimateGroupHeight(photos, 1000, cachedHeight);

      expect(result.source).toBe('calculated');
    });

    it('キャッシュがundefinedの場合は計算を実行する', () => {
      const photos = createMockPhotos(5);

      const result = estimateGroupHeight(photos, 1000, undefined);

      expect(result.source).toBe('calculated');
    });
  });

  describe('写真がない場合', () => {
    it('フォールバック高さを返す', () => {
      const photos: Photo[] = [];

      const result = estimateGroupHeight(photos, 1000, undefined);

      expect(result.height).toBe(
        GROUP_HEIGHT_CONSTANTS.FALLBACK_EMPTY_HEIGHT +
          GROUP_HEIGHT_CONSTANTS.GROUP_SPACING,
      );
      expect(result.source).toBe('fallback');
    });

    it('キャッシュがあれば写真がなくてもキャッシュを使用する', () => {
      const photos: Photo[] = [];
      const cachedHeight = 150;

      const result = estimateGroupHeight(photos, 1000, cachedHeight);

      expect(result.height).toBe(
        cachedHeight + GROUP_HEIGHT_CONSTANTS.GROUP_SPACING,
      );
      expect(result.source).toBe('cache');
    });
  });

  describe('計算による推定', () => {
    it('containerWidth > 0 の場合は正確な高さを計算する', () => {
      const photos = createMockPhotos(5);
      const containerWidth = 1000;
      const calculator = new JustifiedLayoutCalculator();
      const expectedHeight = calculator.calculateTotalHeight(
        photos,
        containerWidth,
      );

      const result = estimateGroupHeight(
        photos,
        containerWidth,
        undefined,
        calculator,
      );

      expect(result.height).toBe(
        expectedHeight + GROUP_HEIGHT_CONSTANTS.GROUP_SPACING,
      );
      expect(result.source).toBe('calculated');
    });

    it('containerWidth = 0 の場合はデフォルト幅で計算する', () => {
      const photos = createMockPhotos(5);
      const calculator = new JustifiedLayoutCalculator();
      const expectedHeight = calculator.calculateTotalHeight(
        photos,
        GROUP_HEIGHT_CONSTANTS.DEFAULT_CONTAINER_WIDTH,
      );

      const result = estimateGroupHeight(photos, 0, undefined, calculator);

      expect(result.height).toBe(
        expectedHeight + GROUP_HEIGHT_CONSTANTS.GROUP_SPACING,
      );
      expect(result.source).toBe('calculated');
    });

    it('calculator が渡されない場合は内部で作成する', () => {
      const photos = createMockPhotos(3);
      const containerWidth = 800;

      const result = estimateGroupHeight(photos, containerWidth, undefined);

      expect(result.source).toBe('calculated');
      expect(result.height).toBeGreaterThan(
        GROUP_HEIGHT_CONSTANTS.GROUP_SPACING,
      );
    });
  });

  describe('高さの妥当性', () => {
    it('返される高さは常に GROUP_SPACING 以上である', () => {
      // キャッシュあり
      const result1 = estimateGroupHeight([], 1000, 100);
      expect(result1.height).toBeGreaterThanOrEqual(
        GROUP_HEIGHT_CONSTANTS.GROUP_SPACING,
      );

      // 写真なし
      const result2 = estimateGroupHeight([], 1000, undefined);
      expect(result2.height).toBeGreaterThanOrEqual(
        GROUP_HEIGHT_CONSTANTS.GROUP_SPACING,
      );

      // 写真あり
      const result3 = estimateGroupHeight(createMockPhotos(5), 1000, undefined);
      expect(result3.height).toBeGreaterThanOrEqual(
        GROUP_HEIGHT_CONSTANTS.GROUP_SPACING,
      );
    });

    it('写真が多いほど高さが増加する', () => {
      const containerWidth = 1000;
      const height1 = estimateGroupHeight(
        createMockPhotos(1),
        containerWidth,
        undefined,
      ).height;
      const height5 = estimateGroupHeight(
        createMockPhotos(5),
        containerWidth,
        undefined,
      ).height;
      const height20 = estimateGroupHeight(
        createMockPhotos(20),
        containerWidth,
        undefined,
      ).height;

      expect(height5).toBeGreaterThan(height1);
      expect(height20).toBeGreaterThan(height5);
    });

    it('calculateTotalHeight と整合性がある', () => {
      const photos = createMockPhotos(8);
      const containerWidth = 1000;
      const calculator = new JustifiedLayoutCalculator();

      const estimatedResult = estimateGroupHeight(
        photos,
        containerWidth,
        undefined,
        calculator,
      );
      const directCalculation = calculator.calculateTotalHeight(
        photos,
        containerWidth,
      );

      expect(estimatedResult.height).toBe(
        directCalculation + GROUP_HEIGHT_CONSTANTS.GROUP_SPACING,
      );
    });
  });
});

describe('precomputeGroupHeights', () => {
  it('全グループの高さを計算してキャッシュに保存する', () => {
    const groups = [
      { key: 'group-1', photos: createMockPhotos(3) },
      { key: 'group-2', photos: createMockPhotos(5) },
      { key: 'group-3', photos: createMockPhotos(2) },
    ];
    const containerWidth = 1000;

    const cache = precomputeGroupHeights(groups, containerWidth);

    expect(cache.size).toBe(3);
    expect(cache.has('group-1')).toBe(true);
    expect(cache.has('group-2')).toBe(true);
    expect(cache.has('group-3')).toBe(true);

    // 高さが妥当な値であることを確認
    for (const [_, height] of cache) {
      expect(height).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(
        LAYOUT_CONSTANTS.HEADER_HEIGHT + LAYOUT_CONSTANTS.SPACING,
      );
    }
  });

  it('既存のキャッシュがあるグループはスキップする', () => {
    const groups = [
      { key: 'group-1', photos: createMockPhotos(3) },
      { key: 'group-2', photos: createMockPhotos(5) },
    ];
    const containerWidth = 1000;
    const existingCache = new Map([['group-1', 999]]);

    const cache = precomputeGroupHeights(groups, containerWidth, existingCache);

    expect(cache.size).toBe(2);
    expect(cache.get('group-1')).toBe(999); // 既存値が保持される
    expect(cache.get('group-2')).toBeGreaterThan(0); // 新規計算
  });

  it('containerWidth = 0 の場合は計算をスキップする', () => {
    const groups = [
      { key: 'group-1', photos: createMockPhotos(3) },
      { key: 'group-2', photos: createMockPhotos(5) },
    ];

    const cache = precomputeGroupHeights(groups, 0);

    expect(cache.size).toBe(0);
  });

  it('空のグループ配列でも正常に動作する', () => {
    const cache = precomputeGroupHeights([], 1000);

    expect(cache.size).toBe(0);
  });

  it('既存のキャッシュを変更する（ミュータブル）', () => {
    const groups = [{ key: 'group-new', photos: createMockPhotos(3) }];
    const containerWidth = 1000;
    const existingCache = new Map([['group-old', 500]]);

    const resultCache = precomputeGroupHeights(
      groups,
      containerWidth,
      existingCache,
    );

    // 同じ参照であることを確認
    expect(resultCache).toBe(existingCache);
    expect(resultCache.has('group-old')).toBe(true);
    expect(resultCache.has('group-new')).toBe(true);
  });

  it('写真がないグループも正しく計算する', () => {
    const groups = [
      { key: 'empty-group', photos: [] },
      { key: 'with-photos', photos: createMockPhotos(3) },
    ];
    const containerWidth = 1000;

    const cache = precomputeGroupHeights(groups, containerWidth);

    expect(cache.size).toBe(2);
    expect(cache.get('empty-group')).toBe(
      LAYOUT_CONSTANTS.HEADER_HEIGHT + LAYOUT_CONSTANTS.SPACING,
    );
    const emptyGroupHeight = cache.get('empty-group');
    expect(emptyGroupHeight).toBeDefined();
    expect(cache.get('with-photos')).toBeGreaterThan(emptyGroupHeight ?? 0);
  });
});

describe('GROUP_HEIGHT_CONSTANTS', () => {
  it('GROUP_SPACING は正の値である', () => {
    expect(GROUP_HEIGHT_CONSTANTS.GROUP_SPACING).toBeGreaterThan(0);
  });

  it('DEFAULT_CONTAINER_WIDTH は妥当な画面幅である', () => {
    expect(GROUP_HEIGHT_CONSTANTS.DEFAULT_CONTAINER_WIDTH).toBeGreaterThan(800);
    expect(GROUP_HEIGHT_CONSTANTS.DEFAULT_CONTAINER_WIDTH).toBeLessThan(2000);
  });

  it('FALLBACK_EMPTY_HEIGHT は LAYOUT_CONSTANTS と整合性がある', () => {
    expect(GROUP_HEIGHT_CONSTANTS.FALLBACK_EMPTY_HEIGHT).toBe(
      LAYOUT_CONSTANTS.HEADER_HEIGHT + LAYOUT_CONSTANTS.SPACING,
    );
  });
});
