import * as path from 'node:path';
import { Worker } from 'node:worker_threads';

import { Effect } from 'effect';
import { match, P } from 'ts-pattern';

import type { ImageGenerationError } from './errors';
import { WorkerCrashed } from './errors';
import type { ImageGenerationJob } from './jobRunner';
import type { RenderWorkerResponse } from './renderWorker';

/**
 * renderWorker のスクリプトパスを解決する。
 *
 * Electron の Main プロセスは dev/packaged いずれも electron/vite.config.ts で
 * ビルドした main/index.cjs から起動される（`pnpm dev:electron` / `pnpm build:electron`
 * を参照）。renderWorker.cjs も同じ main/ 直下に出力されるため、
 * このモジュール自身の __dirname（= main/）からの単純な相対パスで解決できる。
 */
const resolveWorkerScriptPath = (): string =>
  path.join(__dirname, 'renderWorker.cjs');

/** _tag を手がかりに worker からのエラーを ImageGenerationError として復元する */
const parseWorkerError = (error: unknown): ImageGenerationError =>
  match(error)
    .with(
      {
        _tag: P.union(
          'WorldApiFailed',
          'ImageDownloadFailed',
          'SvgRenderFailed',
          'ImageConversionFailed',
          'FontLoadFailed',
          'FileWriteFailed',
          'WorkerCrashed',
        ),
      },
      // renderWorker.ts は ImageGenerationError の構造化クローンのみを送出する
      (e) => e as ImageGenerationError,
    )
    .otherwise(
      () =>
        new WorkerCrashed({
          message: `renderWorker から不明な形式のエラーを受信しました: ${JSON.stringify(error)}`,
        }),
    );

/**
 * 画像生成ジョブを worker_threads 上で実行し、結果の Buffer を返す。
 *
 * 背景: resvg-js によるレンダリングは同期・CPU バウンドなネイティブ処理であり、
 * Main プロセスで直接実行するとウィンドウメッセージポンプ・IPC を共有する
 * イベントループが専有され、アプリ全体が応答不能になる
 * (ADR-005: docs/adr/005-main-process-cpu-bound-worker-offload.md)。
 * worker_threads に隔離することでこの制約を構造的に排除する。
 *
 * @param workerScriptPath テストで実スクリプトパスを差し替えるためのオプション引数
 */
export const runInWorker = (
  job: ImageGenerationJob,
  workerScriptPath: string = resolveWorkerScriptPath(),
): Effect.Effect<Buffer, ImageGenerationError> =>
  Effect.async<Buffer, ImageGenerationError>((resume) => {
    const worker = new Worker(workerScriptPath);
    let settled = false;

    const cleanup = () => {
      worker.removeAllListeners();
      void worker.terminate();
    };

    const settle = (effect: Effect.Effect<Buffer, ImageGenerationError>) => {
      if (settled) {
        return;
      }
      settled = true;
      resume(effect);
      cleanup();
    };

    worker.once('message', (response: RenderWorkerResponse) => {
      if (response.ok) {
        settle(Effect.succeed(Buffer.from(response.base64, 'base64')));
      } else {
        settle(Effect.fail(parseWorkerError(response.error)));
      }
    });

    worker.once('error', (error) => {
      settle(
        Effect.fail(
          new WorkerCrashed({
            message: error instanceof Error ? error.message : String(error),
          }),
        ),
      );
    });

    worker.once('exit', (code) => {
      if (code !== 0) {
        settle(
          Effect.fail(
            new WorkerCrashed({
              message: `renderWorker が exit code ${code} で終了しました`,
            }),
          ),
        );
      }
    });

    worker.postMessage(job);

    return Effect.sync(cleanup);
  });
