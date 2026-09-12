import { parentPort } from 'node:worker_threads';

import { Cause, Effect, Exit, Option } from 'effect';

import type { ImageGenerationJob } from './jobRunner';
import { runImageGenerationJob } from './jobRunner';

/**
 * worker_threads 経由でやり取りするレスポンス。
 *
 * Buffer は base64 文字列に変換して渡す（構造化クローンの transferable 管理を
 * 呼び出し側・worker 側の双方に持たせないための単純化）。
 * error は Data.TaggedError インスタンスではなく `_tag` を持つプレーンオブジェクトになる
 * (構造化クローンでプロトタイプチェーンは失われるが、Effect.catchTag は `_tag` の
 * 構造的一致で判定するため呼び出し側での再分類に支障はない)。
 */
export type RenderWorkerResponse =
  | { ok: true; base64: string }
  | { ok: false; error: unknown };

if (!parentPort) {
  throw new Error(
    'renderWorker.ts は worker_threads の Worker としてのみ実行できます',
  );
}

const port = parentPort;

const handleMessage = async (job: ImageGenerationJob): Promise<void> => {
  const exit = await Effect.runPromiseExit(runImageGenerationJob(job));

  if (Exit.isSuccess(exit)) {
    port.postMessage({
      ok: true,
      base64: exit.value.toString('base64'),
    } satisfies RenderWorkerResponse);
    return;
  }

  const failure = Cause.failureOption(exit.cause);
  if (Option.isSome(failure)) {
    port.postMessage({
      ok: false,
      error: failure.value,
    } satisfies RenderWorkerResponse);
    return;
  }

  // 予期しない失敗（Defect/Interrupt）は throw して worker の 'error' イベントに
  // 変換させる。Main 側の workerClient がここで Sentry 送信を担う。
  throw Cause.squash(exit.cause);
};

// on() の型は void を返すリスナーを期待するため、Promise を明示的に void 化する。
// handleMessage が reject した場合は意図的に catch せず、unhandledRejection として
// worker を終了させ、Main 側の 'error' イベントに変換させる。
port.on('message', (job: ImageGenerationJob) => {
  void handleMessage(job);
});
