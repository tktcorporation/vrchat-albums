import { Effect } from 'effect';
import { z } from 'zod';
import { runEffect } from '../../lib/effectTRPC';
import { UserFacingError } from './../../lib/errors';
import { logger } from './../../lib/logger';
import { procedure, router as trpcRouter } from './../../trpc';
import { type VRChatWorldId, VRChatWorldIdSchema } from '../vrchatLog/model';
import type { VRChatWorldInfoFromApi } from './service';
import * as vrchatApiService from './service';

/**
 * VRChat API からワールド情報を取得（null を返すことで silent エラー扱い）
 */
const getVrcWorldInfoByWorldId = (
  worldId: VRChatWorldId,
): Promise<VRChatWorldInfoFromApi | null> => {
  return runEffect(
    vrchatApiService.getVrcWorldInfoByWorldId(worldId).pipe(
      // WORLD_NOT_FOUND は正常系 → null
      Effect.catchTag('VRChatApiWorldNotFound', () => Effect.succeed(null)),
      // API_REQUEST_FAILED は警告のみ → null
      Effect.catchTag('VRChatApiRequestFailed', (e) => {
        logger.warnWithSentry({
          message: `VRChat API request failed: ${e.message}`,
          details: { worldId },
        });
        return Effect.succeed(null);
      }),
      // PARSE_ERROR は予期しないエラー → die（Sentry に送信）
      Effect.catchTag('VRChatApiParseError', (e) =>
        Effect.die(new Error(`VRChat API parse error: ${e.issues}`)),
      ),
    ),
  );
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
      const exit = await Effect.runPromiseExit(
        vrchatApiService.getVrcUserInfoByUserName(name),
      );
      if (exit._tag === 'Success') {
        return {
          searchName: name,
          user: exit.value,
        };
      }
      return {
        searchName: name,
        user: null,
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
