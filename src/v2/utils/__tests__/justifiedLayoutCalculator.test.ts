import { beforeEach, describe, expect, it } from 'vitest';
import { VRChatPhotoPathSchema } from '../../../valueObjects';
import { LAYOUT_CONSTANTS } from '../../constants/layoutConstants';
import type { Photo } from '../../types/photo';
import { JustifiedLayoutCalculator } from '../justifiedLayoutCalculator';

describe('JustifiedLayoutCalculator', () => {
  let calculator: JustifiedLayoutCalculator;

  beforeEach(() => {
    calculator = new JustifiedLayoutCalculator();
  });

  /**
   * 指定数のダミー写真データを生成するユーティリティ。
   * レイアウト計算のテストで一括生成に利用する。
   */
  const createMockPhotos = (count: number): Photo[] =>
    Array.from({ length: count }, (_, i) => {
      const padded = String(i).padStart(2, '0');
      const photoPath = VRChatPhotoPathSchema.parse(
        `/path/VRChat_2025-05-25_12-00-${padded}.000_1920x1080.png`,
      );
      return {
        loadingState: 'loaded' as const,
        id: `photo-${i}`,
        photoPath,
        fileNameWithExt: photoPath.fileName,
        width: 1920,
        height: 1080,
        takenAt: new Date(),
        location: {
          joinedAt: new Date(),
        },
      };
    });

  describe('calculateLayout', () => {
    it('コンテナ幅が0の場合は空の結果を返す', () => {
      const photos = createMockPhotos(3);
      const result = calculator.calculateLayout(photos, 0);

      expect(result.rows).toEqual([]);
      expect(result.totalHeight).toBe(0);
      expect(result.gridHeight).toBe(0);
    });

    it('写真が0枚の場合はヘッダーとスペースのみの高さを返す', () => {
      const result = calculator.calculateLayout([], 1000);

      expect(result.rows).toEqual([]);
      expect(result.totalHeight).toBe(
        LAYOUT_CONSTANTS.HEADER_HEIGHT + LAYOUT_CONSTANTS.SPACING,
      );
      expect(result.gridHeight).toBe(0);
    });

    it('1枚の写真を適切にレイアウトする', () => {
      const photos = createMockPhotos(1);
      const result = calculator.calculateLayout(photos, 800);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toHaveLength(1);

      const photo = result.rows[0][0];
      expect(photo.displayHeight).toBeLessThanOrEqual(
        LAYOUT_CONSTANTS.TARGET_ROW_HEIGHT,
      );
      expect(photo.displayWidth).toBeGreaterThan(0);
    });

    it('複数枚の写真を複数行に分配する', () => {
      const photos = createMockPhotos(8);
      const result = calculator.calculateLayout(photos, 800);

      expect(result.rows.length).toBeGreaterThan(1);
      expect(result.totalHeight).toBeGreaterThan(
        LAYOUT_CONSTANTS.HEADER_HEIGHT + LAYOUT_CONSTANTS.SPACING,
      );

      // 各行の写真が適切にスケーリングされているか確認
      result.rows.forEach((row, rowIndex) => {
        if (rowIndex < result.rows.length - 1) {
          // 最後の行以外は幅がコンテナに近い値になっているか確認
          const totalWidth = row.reduce(
            (sum, photo, photoIndex) =>
              sum +
              photo.displayWidth +
              (photoIndex > 0 ? LAYOUT_CONSTANTS.GAP : 0),
            0,
          );
          expect(totalWidth).toBeGreaterThan(700); // 妥当な範囲で確認
          expect(totalWidth).toBeLessThan(850);
        }
      });
    });

    it('アスペクト比が異なる写真を適切に処理する', () => {
      const portraitPath = VRChatPhotoPathSchema.parse(
        '/path/VRChat_2025-05-25_12-00-00.000_1080x1920.png',
      );
      const landscapePath = VRChatPhotoPathSchema.parse(
        '/path/VRChat_2025-05-25_12-00-01.000_1920x1080.png',
      );
      const photos: Photo[] = [
        {
          loadingState: 'loaded' as const,
          id: 'portrait',
          photoPath: portraitPath,
          fileNameWithExt: portraitPath.fileName,
          width: 1080,
          height: 1920, // 縦長
          takenAt: new Date(),
          location: {
            joinedAt: new Date(),
          },
        },
        {
          loadingState: 'loaded' as const,
          id: 'landscape',
          photoPath: landscapePath,
          fileNameWithExt: landscapePath.fileName,
          width: 1920,
          height: 1080, // 横長
          takenAt: new Date(),
          location: {
            joinedAt: new Date(),
          },
        },
      ];

      const result = calculator.calculateLayout(photos, 800);

      expect(result.rows).toHaveLength(1); // 2枚とも同じ行に配置される可能性が高い
      const row = result.rows[0];

      // 縦長写真は横長写真より幅が狭いはず
      const portrait = row.find((p) => p.id === 'portrait');
      const landscape = row.find((p) => p.id === 'landscape');

      if (portrait && landscape) {
        expect(portrait.displayWidth).toBeLessThan(landscape.displayWidth);
      }
    });
  });

  describe('calculateTotalHeight', () => {
    it('コンテナ幅が0の場合は0を返す', () => {
      const photos = createMockPhotos(3);
      const height = calculator.calculateTotalHeight(photos, 0);

      expect(height).toBe(0);
    });

    it('写真が0枚の場合はヘッダーとスペースの高さを返す', () => {
      const height = calculator.calculateTotalHeight([], 800);

      expect(height).toBe(
        LAYOUT_CONSTANTS.HEADER_HEIGHT + LAYOUT_CONSTANTS.SPACING,
      );
    });

    it('calculateLayoutの総高さと近似値を返す', () => {
      const photos = createMockPhotos(5);
      const containerWidth = 800;

      const layoutResult = calculator.calculateLayout(photos, containerWidth);
      const totalHeight = calculator.calculateTotalHeight(
        photos,
        containerWidth,
      );

      // 軽量版は簡易計算のため、妥当な範囲内で確認
      const heightDiff = Math.abs(totalHeight - layoutResult.totalHeight);
      expect(heightDiff).toBeLessThan(20); // 20px以内の誤差は許容
    });

    it('写真の数が増えると高さも増加する', () => {
      const containerWidth = 800;
      const height1 = calculator.calculateTotalHeight(
        createMockPhotos(1),
        containerWidth,
      );
      const height3 = calculator.calculateTotalHeight(
        createMockPhotos(3),
        containerWidth,
      );
      const height10 = calculator.calculateTotalHeight(
        createMockPhotos(10),
        containerWidth,
      );

      expect(height3).toBeGreaterThan(height1);
      expect(height10).toBeGreaterThan(height3);
    });

    it('コンテナ幅が狭いと高さが増加する', () => {
      const photos = createMockPhotos(8);
      const heightWide = calculator.calculateTotalHeight(photos, 1200);
      const heightNarrow = calculator.calculateTotalHeight(photos, 600);

      expect(heightNarrow).toBeGreaterThan(heightWide);
    });
  });

  describe('カスタム定数での動作', () => {
    it('カスタム定数で動作する', () => {
      const customConstants = {
        ...LAYOUT_CONSTANTS,
        TARGET_ROW_HEIGHT: 150,
        GAP: 8,
        HEADER_HEIGHT: 120,
        SPACING: 16,
      } as const;

      const customCalculator = new JustifiedLayoutCalculator(customConstants);
      const photos = createMockPhotos(3);
      const result = customCalculator.calculateLayout(photos, 800);

      expect(result.totalHeight).toBe(
        customConstants.HEADER_HEIGHT +
          customConstants.SPACING +
          result.gridHeight,
      );
    });
  });

  describe('edge cases', () => {
    it('写真の幅・高さがnullの場合はデフォルト値を使用する', () => {
      const photoPath = VRChatPhotoPathSchema.parse(
        '/path/VRChat_2025-05-25_12-00-00.000_1920x1080.png',
      );
      const photos: Photo[] = [
        {
          loadingState: 'loaded' as const,
          id: 'no-dimensions',
          photoPath,
          fileNameWithExt: photoPath.fileName,
          width: 0,
          height: 0,
          takenAt: new Date(),
          location: {
            joinedAt: new Date(),
          },
        },
      ];

      const result = calculator.calculateLayout(photos, 800);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toHaveLength(1);
      expect(result.rows[0][0].width).toBe(1920); // デフォルト値
      expect(result.rows[0][0].height).toBe(1080); // デフォルト値
    });

    it('非常に狭いコンテナでも動作する', () => {
      const photos = createMockPhotos(2);
      const result = calculator.calculateLayout(photos, 100);

      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.totalHeight).toBeGreaterThan(0);
    });

    it('非常に幅広いコンテナでは1行に多くの写真が配置される', () => {
      const photos = createMockPhotos(10);
      const result = calculator.calculateLayout(photos, 5000);

      // 幅が十分あれば行数は少なくなるはず
      expect(result.rows.length).toBeLessThanOrEqual(3);
    });
  });
});
