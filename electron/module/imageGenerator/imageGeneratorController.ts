import { Effect } from 'effect';
import { z } from 'zod';

import { runEffect } from '../../lib/effectTRPC';
import { mapToUnknownError } from '../../lib/errorMapping';
import { procedure, router as trpcRouter } from '../../trpc';
import { generateSharePreview } from './service';

/**
 * ImageGenerationError → UserFacingError 変換ヘルパー
 *
 * cause を含めて Sentry が元エラーを追跡可能にする。
 */
const mapImageGenerationError = mapToUnknownError(
  '画像生成中にエラーが発生しました。',
);

/**
 * 画像生成の tRPC ルーター
 *
 * 背景: Renderer 側の Canvas API ベース画像生成を Main プロセスに移行するため導入。
 * resvg-js を使い、Node.js 側で SVG → PNG 変換を行う。
 *
 * generateSharePreview は入力に対して決定的な PNG を返す純粋な導出計算であり、
 * サーバー側の状態変更を伴わない。mutation ではなく query として実装することで、
 * react-query の queryKey（値の構造的ハッシュ）による重複排除・キャッシュが働き、
 * 「同じ入力に対しては1回しか計算しない」という不変条件をライブラリ側に保証させる
 * (ADR-006: docs/adr/006-derived-data-trpc-query-not-mutation.md)。
 *
 * 呼び出し元: ShareDialog (src/v2/components/LocationGroupHeader/ShareDialog.tsx)
 */
export const imageGeneratorRouter = trpcRouter({
  generateSharePreview: procedure
    .input(
      z.object({
        worldName: z.string(),
        /** VRChat ワールド画像の base64。10MB 上限（元画像 ~7.5MB 相当） */
        imageBase64: z.string().max(10_000_000),
        players: z.array(z.object({ playerName: z.string() })).nullable(),
        showAllPlayers: z.boolean(),
      }),
    )
    .query(({ input }) =>
      runEffect(
        generateSharePreview(input).pipe(
          Effect.mapError(mapImageGenerationError),
        ),
      ),
    ),
});
