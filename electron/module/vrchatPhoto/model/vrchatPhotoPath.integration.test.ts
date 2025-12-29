import * as datefns from 'date-fns';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as client from '../../../lib/sequelize';
import {
  createOrUpdateListVRChatPhotoPath,
  getVRChatPhotoMetadataList,
  getVRChatPhotoPathCount,
  getVRChatPhotoPathList,
  getVRChatPhotoPathsByIds,
} from './vrchatPhotoPath.model';

/**
 * VRChatPhotoPath モデル関数のインテグレーションテスト
 *
 * ハイブリッドローディングに必要なモデル関数のテスト:
 * - getVRChatPhotoPathCount: ページネーション用のカウント
 * - getVRChatPhotoMetadataList: 軽量メタデータ取得（初回クエリ）
 * - getVRChatPhotoPathsByIds: IDでオンデマンドバッチ取得
 */
describe('VRChatPhotoPath Model Integration Tests', () => {
  beforeAll(async () => {
    client.__initTestRDBClient();
  }, 10000);

  beforeEach(async () => {
    await client.__forceSyncRDBClient();
  });

  afterAll(async () => {
    await client.__cleanupTestRDBClient();
  });

  // テストデータ作成ヘルパー
  const createTestPhotos = async (
    count: number,
    baseDate = new Date('2024-01-15'),
  ) => {
    const photos = Array.from({ length: count }, (_, i) => ({
      photoPath: `/photos/VRChat_${datefns.format(datefns.addHours(baseDate, i), 'yyyy-MM-dd_HH-mm-ss')}.000_1920x1080.png`,
      photoTakenAt: datefns.addHours(baseDate, i),
      width: 1920,
      height: 1080,
    }));
    return createOrUpdateListVRChatPhotoPath(photos);
  };

  describe('getVRChatPhotoPathCount', () => {
    it('テーブルが空の場合は0を返す', async () => {
      const count = await getVRChatPhotoPathCount();
      expect(count).toBe(0);
    });

    it('写真の総件数を正しく返す', async () => {
      await createTestPhotos(5);
      const count = await getVRChatPhotoPathCount();
      expect(count).toBe(5);
    });

    it('gtPhotoTakenAt フィルタで件数を正しく返す', async () => {
      const baseDate = new Date('2024-01-15T10:00:00');
      await createTestPhotos(5, baseDate); // 10:00, 11:00, 12:00, 13:00, 14:00

      const count = await getVRChatPhotoPathCount({
        gtPhotoTakenAt: new Date('2024-01-15T11:30:00'), // 12:00, 13:00, 14:00 が対象
      });
      expect(count).toBe(3);
    });

    it('ltPhotoTakenAt フィルタで件数を正しく返す', async () => {
      const baseDate = new Date('2024-01-15T10:00:00');
      await createTestPhotos(5, baseDate);

      const count = await getVRChatPhotoPathCount({
        ltPhotoTakenAt: new Date('2024-01-15T12:30:00'), // 10:00, 11:00, 12:00 が対象
      });
      expect(count).toBe(3);
    });

    it('両方のフィルタを組み合わせて件数を正しく返す', async () => {
      const baseDate = new Date('2024-01-15T10:00:00');
      await createTestPhotos(5, baseDate);

      const count = await getVRChatPhotoPathCount({
        gtPhotoTakenAt: new Date('2024-01-15T10:30:00'),
        ltPhotoTakenAt: new Date('2024-01-15T13:30:00'), // 11:00, 12:00, 13:00 が対象
      });
      expect(count).toBe(3);
    });
  });

  describe('getVRChatPhotoMetadataList', () => {
    it('テーブルが空の場合は空配列を返す', async () => {
      const result = await getVRChatPhotoMetadataList({
        orderByPhotoTakenAt: 'asc',
      });
      expect(result).toEqual([]);
    });

    it('軽量メタデータのみを返す（photoPath を含まない）', async () => {
      await createTestPhotos(3);

      const result = await getVRChatPhotoMetadataList({
        orderByPhotoTakenAt: 'asc',
      });

      expect(result).toHaveLength(3);
      for (const item of result) {
        expect(item).toHaveProperty('id');
        expect(item).toHaveProperty('photoTakenAt');
        expect(item).toHaveProperty('width');
        expect(item).toHaveProperty('height');
        // photoPath は含まれない
        expect(item).not.toHaveProperty('photoPath');
      }
    });

    it('asc でソートされる', async () => {
      const baseDate = new Date('2024-01-15T10:00:00');
      await createTestPhotos(3, baseDate);

      const result = await getVRChatPhotoMetadataList({
        orderByPhotoTakenAt: 'asc',
      });

      expect(result).toHaveLength(3);
      for (let i = 1; i < result.length; i++) {
        const prevTime = new Date(result[i - 1].photoTakenAt).getTime();
        const currTime = new Date(result[i].photoTakenAt).getTime();
        expect(prevTime).toBeLessThanOrEqual(currTime);
      }
    });

    it('desc でソートされる', async () => {
      const baseDate = new Date('2024-01-15T10:00:00');
      await createTestPhotos(3, baseDate);

      const result = await getVRChatPhotoMetadataList({
        orderByPhotoTakenAt: 'desc',
      });

      expect(result).toHaveLength(3);
      for (let i = 1; i < result.length; i++) {
        const prevTime = new Date(result[i - 1].photoTakenAt).getTime();
        const currTime = new Date(result[i].photoTakenAt).getTime();
        expect(prevTime).toBeGreaterThanOrEqual(currTime);
      }
    });

    it('日付フィルタが機能する', async () => {
      const baseDate = new Date('2024-01-15T10:00:00');
      await createTestPhotos(5, baseDate);

      const result = await getVRChatPhotoMetadataList({
        gtPhotoTakenAt: new Date('2024-01-15T11:30:00'),
        ltPhotoTakenAt: new Date('2024-01-15T13:30:00'),
        orderByPhotoTakenAt: 'asc',
      });

      expect(result).toHaveLength(2); // 12:00, 13:00
    });
  });

  describe('getVRChatPhotoPathsByIds', () => {
    it('空の配列を渡すと空のMapを返す', async () => {
      const result = await getVRChatPhotoPathsByIds([]);
      expect(result.size).toBe(0);
    });

    it('存在しないIDを渡すと空のMapを返す', async () => {
      await createTestPhotos(3);
      // 有効なUUIDv7形式だが、DBに存在しないID
      const result = await getVRChatPhotoPathsByIds([uuidv7(), uuidv7()]);
      expect(result.size).toBe(0);
    });

    it('存在するIDでphotoPathを正しく取得する', async () => {
      const createdModels = await createTestPhotos(3);
      const ids = createdModels.map((m) => m.id);

      const result = await getVRChatPhotoPathsByIds(ids);

      expect(result.size).toBe(3);
      for (const model of createdModels) {
        expect(result.get(model.id)).toBe(model.photoPath);
      }
    });

    it('混合IDで存在するもののみ返す', async () => {
      const createdModels = await createTestPhotos(3);
      const validIds = createdModels.slice(0, 2).map((m) => m.id);
      // 有効なUUIDv7形式だが、DBに存在しないID
      const nonExistentId = uuidv7();
      const mixedIds = [...validIds, nonExistentId];

      const result = await getVRChatPhotoPathsByIds(mixedIds);

      expect(result.size).toBe(2);
      expect(result.has(validIds[0])).toBe(true);
      expect(result.has(validIds[1])).toBe(true);
      expect(result.has(nonExistentId)).toBe(false);
    });

    it('大量のIDでも正しく動作する', async () => {
      const createdModels = await createTestPhotos(100);
      const ids = createdModels.map((m) => m.id);

      const result = await getVRChatPhotoPathsByIds(ids);

      expect(result.size).toBe(100);
    });
  });

  describe('getVRChatPhotoPathList pagination', () => {
    it('limit が機能する', async () => {
      await createTestPhotos(10);

      const result = await getVRChatPhotoPathList({
        orderByPhotoTakenAt: 'asc',
        limit: 5,
      });

      expect(result).toHaveLength(5);
    });

    it('offset が機能する', async () => {
      const createdModels = await createTestPhotos(10);

      const result = await getVRChatPhotoPathList({
        orderByPhotoTakenAt: 'asc',
        limit: 3,
        offset: 5,
      });

      expect(result).toHaveLength(3);
      // 5番目から3件なので、インデックス5, 6, 7
      expect(result[0].id).toBe(createdModels[5].id);
      expect(result[1].id).toBe(createdModels[6].id);
      expect(result[2].id).toBe(createdModels[7].id);
    });

    it('limit なしで全件取得する', async () => {
      await createTestPhotos(10);

      const result = await getVRChatPhotoPathList({
        orderByPhotoTakenAt: 'asc',
      });

      expect(result).toHaveLength(10);
    });

    it('offset が件数を超える場合は空配列を返す', async () => {
      await createTestPhotos(5);

      const result = await getVRChatPhotoPathList({
        orderByPhotoTakenAt: 'asc',
        offset: 10,
      });

      expect(result).toHaveLength(0);
    });
  });
});
