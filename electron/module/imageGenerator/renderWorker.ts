import { parentPort, workerData } from 'node:worker_threads';

import { Cause, Effect, Exit, Option } from 'effect';

import type { ImageGenerationJob } from './jobRunner';
import { runImageGenerationJob } from './jobRunner';
import { RENDER_WORKER_KIND } from './renderWorkerProtocol';

/**
 * worker_threads 経由でやり取りするレスポンス。
 *
 * Buffer は base64 文字列に変換して渡す（構造化クローンの transferable 管理を
 * 呼び出し側・worker 側の双方に持たせないための単純化）。
 *
 * error は `{ _tag, message }` のプレーンオブジェクトで明示的に組み立てる。
 * `Data.TaggedError` は `Error` のサブクラスであり、構造化クローンの Error 経路は
 * name/message/stack のみを転送して `_tag` 等の独自プロパティを破棄するため、
 * TaggedError インスタンスをそのまま postMessage すると `_tag` が失われ
 * workerClient.ts 側で一切のエラーが再分類不能になる。ここで先に安全な
 * プレーンオブジェクトへ変換しておくことで、その罠を踏まない。
 */
export type RenderWorkerResponse =
  | { ok: true; base64: string }
  | {
      ok: false;
      error: {
        _tag: 'SvgRenderFailed' | 'ImageConversionFailed';
        message: string;
      };
    };

/**
 * ジョブを実行し、結果を `postMessage` 用のレスポンスへ変換して渡す。
 *
 * `postMessage` を引数として受け取ることで、実際の worker_threads の
 * postMessage を経由せずにこの変換ロジック単体をユニットテストできる
 * (renderWorker.spec.ts)。
 */
export const handleMessage = async (
  job: ImageGenerationJob,
  postMessage: (response: RenderWorkerResponse) => void,
): Promise<void> => {
  const exit = await Effect.runPromiseExit(runImageGenerationJob(job));

  if (Exit.isSuccess(exit)) {
    postMessage({ ok: true, base64: exit.value.toString('base64') });
    return;
  }

  const failure = Cause.failureOption(exit.cause);
  if (Option.isSome(failure)) {
    postMessage({
      ok: false,
      error: { _tag: failure.value._tag, message: failure.value.message },
    });
    return;
  }

  // 予期しない失敗（Defect/Interrupt）は throw して worker の 'error' イベントに
  // 変換させる。Main 側の workerClient がここで Sentry 送信を担う。
  throw Cause.squash(exit.cause);
};

// worker_threads の Worker としてロードされた場合のみ待ち受ける。
// このモジュールをテストから import した場合は parentPort が無い（または
// workerData が一致しない）ため何もしない。
if (parentPort && workerData?.kind === RENDER_WORKER_KIND) {
  const port = parentPort;
  // worker は 1 ジョブごとに使い捨てる運用（workerClient.ts が毎回 new Worker() する）
  // ため once で受ける。on() の型は void を返すリスナーを期待するため、
  // Promise を明示的に void 化する。handleMessage が reject した場合は意図的に
  // catch せず、unhandledRejection として worker を終了させ、
  // Main 側の 'error' イベントに変換させる。
  port.once('message', (job: ImageGenerationJob) => {
    void handleMessage(job, (response) => port.postMessage(response));
  });
}
