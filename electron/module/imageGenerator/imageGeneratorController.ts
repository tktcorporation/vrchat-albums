import { match } from 'ts-pattern';
import { z } from 'zod';
import { procedure, router as trpcRouter } from '../../trpc';
import { generateSharePreview } from './service';

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

      if (result.isErr()) {
        throw match(result.error)
          .with(
            { type: 'SVG_RENDER_FAILED' },
            (e) => new Error(`SVG render failed: ${e.message}`),
          )
          .with(
            { type: 'IMAGE_CONVERSION_FAILED' },
            (e) => new Error(`Image conversion failed: ${e.message}`),
          )
          .with(
            { type: 'FONT_LOAD_FAILED' },
            (e) => new Error(`Font load failed: ${e.message}`),
          )
          .with(
            { type: 'WORLD_API_FAILED' },
            (e) => new Error(`World API failed: ${e.message}`),
          )
          .with(
            { type: 'IMAGE_DOWNLOAD_FAILED' },
            (e) => new Error(`Image download failed: ${e.message}`),
          )
          .with(
            { type: 'FILE_WRITE_FAILED' },
            (e) => new Error(`File write failed: ${e.message}`),
          )
          .exhaustive();
      }

      return result.value;
    }),
});
