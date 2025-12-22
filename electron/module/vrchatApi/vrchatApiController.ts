import { match } from 'ts-pattern';
import { z } from 'zod';
import { UserFacingError } from './../../lib/errors';
import { logger } from './../../lib/logger';
import { procedure, router as trpcRouter } from './../../trpc';
import type { VRChatWorldInfoFromApi } from './service';
import * as vrchatApiService from './service';
import { type VRChatWorldId, VRChatWorldIdSchema } from './valueObject';

const getVrcWorldInfoByWorldId = async (
  worldId: VRChatWorldId,
): Promise<VRChatWorldInfoFromApi | null> => {
  const result = await vrchatApiService.getVrcWorldInfoByWorldId(worldId);
  if (result.isErr()) {
    return match(result.error)
      .with('WORLD_NOT_FOUND', () => {
        return null;
      })
      .otherwise((error) => {
        throw error;
      });
  }
  return result.value;
};

const getVrcUserInfoListByUserNameList = async (
  userNameList: string[],
): Promise<
  {
    searchName: string;
    user: z.infer<typeof vrchatApiService.UserSchema> | null;
  }[]
> => {
  const result = await Promise.all(
    userNameList.map(async (name) => {
      const userResult = await vrchatApiService.getVrcUserInfoByUserName(name);
      if (userResult.isErr()) {
        return {
          searchName: name,
          user: null,
        };
      }
      return {
        searchName: name,
        user: userResult.value,
      };
    }),
  );
  return result;
};

import { ofetch } from 'ofetch';

const convertImageToBase64 = async (imageUrl: string): Promise<string> => {
  const userAgent = `Electron ${process.versions.electron}; ${process.platform}; ${process.arch}`;
  const response = await ofetch(imageUrl, {
    headers: {
      'User-Agent': userAgent,
    },
    responseType: 'arrayBuffer',
  });

  if (!response) {
    throw new UserFacingError('画像の取得に失敗しました。');
  }

  const buffer = Buffer.from(response);
  return buffer.toString('base64');
};

export const vrchatApiRouter = trpcRouter({
  getVrcWorldInfoByWorldId: procedure
    .input(VRChatWorldIdSchema)
    .query((ctx) => {
      return getVrcWorldInfoByWorldId(ctx.input);
    }),
  getVrcUserInfoListByUserNameList: procedure
    .input(z.string().array())
    .query((ctx) => {
      return getVrcUserInfoListByUserNameList(ctx.input);
    }),
  convertImageToBase64: procedure
    .input(z.string().min(1))
    .query(async ({ input }: { input: string }) => {
      logger.info('convertImageToBase64', input);
      return convertImageToBase64(input);
    }),
});
