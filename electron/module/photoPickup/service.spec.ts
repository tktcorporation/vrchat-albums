import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as client from '../../lib/sequelize';
import * as service from './service';

describe('photoPickup service', () => {
  beforeAll(async () => {
    await client.__initTestRDBClient();
  }, 10000);

  beforeEach(async () => {
    await client.__forceSyncRDBClient();
  });

  afterAll(async () => {
    await client.__cleanupTestRDBClient();
  });

  describe('addPickup', () => {
    it('写真をピックアップに追加できる', async () => {
      const result = await service.addPickup('photo-id-1');
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().photoId).toBe('photo-id-1');
    });

    it('同じ写真を2回追加しても重複しない', async () => {
      await service.addPickup('photo-id-1');
      const result = await service.addPickup('photo-id-1');
      expect(result.isOk()).toBe(true);

      const list = await service.listPickups();
      expect(list._unsafeUnwrap()).toHaveLength(1);
    });
  });

  describe('removePickup', () => {
    it('ピックアップから削除できる', async () => {
      await service.addPickup('photo-id-1');
      const result = await service.removePickup('photo-id-1');
      expect(result.isOk()).toBe(true);

      const list = await service.listPickups();
      expect(list._unsafeUnwrap()).toHaveLength(0);
    });

    it('存在しない photoId を削除するとエラー', async () => {
      const result = await service.removePickup('nonexistent');
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.type).toBe('NOT_FOUND');
      }
    });
  });

  describe('removeAllPickups', () => {
    it('全件削除できる', async () => {
      await service.addPickup('photo-id-1');
      await service.addPickup('photo-id-2');
      await service.addPickup('photo-id-3');

      const result = await service.removeAllPickups();
      expect(result._unsafeUnwrap()).toBe(3);

      const list = await service.listPickups();
      expect(list._unsafeUnwrap()).toHaveLength(0);
    });
  });

  describe('listPickups', () => {
    it('追加日時の降順で取得できる', async () => {
      await service.addPickup('photo-id-1');
      await service.addPickup('photo-id-2');
      await service.addPickup('photo-id-3');

      const list = await service.listPickups();
      const photoIds = list._unsafeUnwrap().map((p) => p.photoId);
      expect(photoIds).toEqual(['photo-id-3', 'photo-id-2', 'photo-id-1']);
    });
  });

  describe('getPickupPhotoIdSet', () => {
    it('ピック済み photoId の Set を返す', async () => {
      await service.addPickup('photo-id-1');
      await service.addPickup('photo-id-2');

      const set = (await service.getPickupPhotoIdSet())._unsafeUnwrap();
      expect(set.has('photo-id-1')).toBe(true);
      expect(set.has('photo-id-2')).toBe(true);
      expect(set.has('photo-id-3')).toBe(false);
    });
  });
});
