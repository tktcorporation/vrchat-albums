import { z } from 'zod';
import { handleResultError } from '../../lib/errorHelpers';
import {
  ERROR_CATEGORIES,
  ERROR_CODES,
  UserFacingError,
} from '../../lib/errors';
import { procedure, router as trpcRouter } from '../../trpc';
import type { ImageGenerationError } from './error';
import { generateSharePreview } from './service';

/**
 * 画像生成エラーを UserFacingError に変換するマッピング
 *
 * 背景: handleResultError で使用し、ImageGenerationError の各 type を
 * ユーザー向けメッセージに変換する。
 */
const imageGenerationErrorMappings: {
  [key: string]: (error: ImageGenerationError) => UserFacingError;
} & {
  default?: (error: ImageGenerationError) => UserFacingError;
} = {
  SVG_RENDER_FAILED: (error) =>
    UserFacingError.withStructuredInfo({
      code: ERROR_CODES.UNKNOWN,
      category: ERROR_CATEGORIES.UNKNOWN_ERROR,
      message: `SVG render failed: ${error.message}`,
      userMessage: '画像の生成に失敗しました。',
    }),
  FONT_LOAD_FAILED: (error) =>
    UserFacingError.withStructuredInfo({
      code: ERROR_CODES.FILE_NOT_FOUND,
      category: ERROR_CATEGORIES.FILE_NOT_FOUND,
      message: `Font load failed: ${error.message}`,
      userMessage: 'フォントの読み込みに失敗しました。',
    }),
  default: (error) =>
    UserFacingError.withStructuredInfo({
      code: ERROR_CODES.UNKNOWN,
      category: ERROR_CATEGORIES.UNKNOWN_ERROR,
      message: `Image generation failed: ${error.message}`,
      userMessage: '画像生成中にエラーが発生しました。',
    }),
};

/**
 * 画像生成の tRPC ルーター
 *
 * 背景: Renderer 側の Canvas API ベース画像生成を Main プロセスに移行するため導入。
 * resvg-js を使い、Node.js 側で SVG → PNG 変換を行う。
 *
 * 呼び出し元: ShareDialog (src/v2/components/LocationGroupHeader/ShareDialog.tsx)
 */
export const imageGeneratorRouter = trpcRouter({
  generateSharePreview: procedure
    .input(
      z.object({
        worldName: z.string(),
        imageBase64: z.string(),
        players: z.array(z.object({ playerName: z.string() })).nullable(),
        showAllPlayers: z.boolean(),
      }),
    )
    .mutation(async ({ input }) => {
      const result = await generateSharePreview(input);
      return handleResultError(result, imageGenerationErrorMappings);
    }),
});
