import { z } from 'zod';
import { procedure, router } from '../../trpc';
import * as service from './service';

/**
 * 写真ピックアップ（SNS投稿候補の一時ストック）の tRPC ルーター。
 */
export const photoPickupRouter = () =>
  router({
    add: procedure
      .input(z.object({ photoId: z.string() }))
      .mutation(async ({ input }) => {
        const result = await service.addPickup(input.photoId);
        return result._unsafeUnwrap();
      }),

    remove: procedure
      .input(z.object({ photoId: z.string() }))
      .mutation(async ({ input }) => {
        const result = await service.removePickup(input.photoId);
        return result.isOk();
      }),

    removeAll: procedure.mutation(async () => {
      const result = await service.removeAllPickups();
      return result._unsafeUnwrap();
    }),

    list: procedure.query(async () => {
      const result = await service.listPickups();
      return result._unsafeUnwrap();
    }),

    photoIdSet: procedure.query(async () => {
      const result = await service.getPickupPhotoIdSet();
      return Array.from(result._unsafeUnwrap());
    }),
  });
