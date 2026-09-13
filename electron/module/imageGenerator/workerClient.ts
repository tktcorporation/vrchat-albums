import * as path from 'node:path';
import { Worker } from 'node:worker_threads';

import { Effect } from 'effect';
import { match, P } from 'ts-pattern';

import { logger } from '../../lib/logger';
import {
  ImageConversionFailed,
  SvgRenderFailed,
  WorkerCrashed,
} from './errors';
import type { ImageGenerationJob } from './jobRunner';
import type { RenderWorkerResponse } from './renderWorker';
import { RENDER_WORKER_KIND } from './renderWorkerProtocol';

/**
 * renderWorker が応答しない場合に待つ上限時間。
 *
 * resvg のレンダリングは通常数百ms〜数秒で終わるため、これを超える場合は
 * ハングとみなして worker を強制終了する。上限が無いと、worker が応答を返さない
 * まま留まったとき Effect が永久に未解決になり、UI 側は「ローディングが
 * 終わらない」状態で静かに詰まる。
 */
const WORKER_RESPONSE_TIMEOUT_MILLIS = 30_000;

/**
 * renderWorker のスクリプトパスを解決する。
 *
 * Electron の Main プロセスは dev/packaged いずれも electron/vite.config.ts で
 * ビルドした main/index.cjs から起動される（`pnpm dev:electron` / `pnpm build:electron`
 * を参照）。renderWorker.cjs も同じ main/ 直下に出力される。
 *
 * パッケージ済み (asar) 環境では `__dirname` は asar 内の仮想パス
 * （例: `.../resources/app.asar/main`）を指す。electron-builder.cjs の
 * asarUnpack で `main/**` を実ファイルシステム側の `app.asar.unpacked/` にも
 * 展開しているのは、worker_threads が asar 内スクリプトを読めるかどうかが
 * 未検証のため (ADR-005)。この置換をせずに asar 内パスをそのまま渡すと、
 * unpack した実体を一度も参照しない設定だけが残ってしまう。
 */
export const resolveWorkerScriptPath = (
  dirname: string = __dirname,
): string => {
  const unpackedDirname = dirname.includes(`app.asar${path.sep}`)
    ? dirname.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
    : dirname;
  return path.join(unpackedDirname, 'renderWorker.cjs');
};

type WorkerFailure = SvgRenderFailed | ImageConversionFailed | WorkerCrashed;

/**
 * renderWorker.ts から届いた `{ _tag, message }` を対応する TaggedError に再構築する。
 *
 * renderWorker.ts の型は `_tag` を 'SvgRenderFailed' | 'ImageConversionFailed' に
 * 限定しているが、ここは worker_threads という別スレッドの境界を越えて届いた値であり、
 * 送信側の型はこちら側では検証できない（ビルド不整合等の異常事態を含む）。
 * そのため受け取り側では `unknown` として構造的に検証し、
 * 未知の形状は `.otherwise()` で WorkerCrashed に落として Main プロセスを守る
 * (堅牢性ガイドライン: 外部境界は Zod 相当の構造検証を行う)。
 */
const reconstructError = (error: unknown): WorkerFailure =>
  match(error)
    .with(
      { _tag: 'SvgRenderFailed', message: P.string },
      (e) => new SvgRenderFailed({ message: e.message }),
    )
    .with(
      { _tag: 'ImageConversionFailed', message: P.string },
      (e) => new ImageConversionFailed({ message: e.message }),
    )
    .otherwise(
      () =>
        new WorkerCrashed({
          message: `renderWorker から不明な形式のエラーを受信しました: ${JSON.stringify(error)}`,
        }),
    );

/**
 * worker が予期せず異常終了・無応答になったことを WorkerCrashed として報告する。
 *
 * これは (SvgRenderFailed/ImageConversionFailed のような) worker 内で正しく
 * 分類済みの期待されるエラーとは異なり、本来 Defect 相当の異常事態
 * （native crash、ハング、ビルド不整合等）である。WorkerCrashed という
 * 「予期されたエラー」型に変換してしまうと呼び出し元では通常のエラーとして
 * 静かに扱われ、Sentry にも届かなくなる（.claude/rules/error-handling.md）。
 * そのため変換前にここで明示的に Sentry へ送出する。
 */
const reportWorkerAnomaly = (message: string, cause?: Error): WorkerCrashed => {
  logger.warnWithSentry({
    message: `renderWorker anomaly: ${message}`,
    stack: cause,
  });
  return new WorkerCrashed({ message });
};

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
 * @param timeoutMillis テストで待機時間を短縮するためのオプション引数
 */
export const runInWorker = (
  job: ImageGenerationJob,
  workerScriptPath: string = resolveWorkerScriptPath(),
  timeoutMillis: number = WORKER_RESPONSE_TIMEOUT_MILLIS,
): Effect.Effect<Buffer, WorkerFailure> =>
  Effect.async<Buffer, WorkerFailure>((resume) => {
    // new Worker() が同期的に throw した場合（不正なパス・リソース枯渇等）は
    // Effect.async がそれを自動的に defect (予期しないエラー) として捕捉するため、
    // ここではラップしない (ADR-002: 予期しないエラーは再スロー/Sentry送信)
    const worker = new Worker(workerScriptPath, {
      workerData: { kind: RENDER_WORKER_KIND },
    });
    let settled = false;
    let cleanedUp = false;

    const cleanup = () => {
      if (cleanedUp) {
        return;
      }
      cleanedUp = true;
      worker.removeAllListeners();
      // 上の removeAllListeners で 'error' リスナーも外れるため、
      // cleanup 後に worker が 'error' を emit してもリスナー0件で
      // 例外化しないよう空リスナーを残す
      worker.on('error', () => {});
      void worker.terminate();
    };

    const settle = (effect: Effect.Effect<Buffer, WorkerFailure>) => {
      if (settled) {
        return;
      }
      settled = true;
      resume(effect);
      cleanup();
    };

    worker.once('message', (message: RenderWorkerResponse) => {
      match(message)
        .with({ ok: true, base64: P.string }, (m) =>
          settle(Effect.succeed(Buffer.from(m.base64, 'base64'))),
        )
        .with({ ok: false }, (m) =>
          settle(Effect.fail(reconstructError(m.error))),
        )
        .otherwise(() =>
          settle(
            Effect.fail(
              reportWorkerAnomaly(
                `renderWorker から不正な形式のメッセージを受信しました: ${JSON.stringify(message)}`,
              ),
            ),
          ),
        );
    });

    worker.once('error', (error) => {
      const cause = error instanceof Error ? error : new Error(String(error));
      settle(Effect.fail(reportWorkerAnomaly(cause.message, cause)));
    });

    // message も 'error' も届かないまま終了した場合（code 0 を含む）も、
    // settle 漏れで Effect が永久に未解決になることを防ぐため必ず失敗させる
    worker.once('exit', (code) => {
      settle(
        Effect.fail(
          reportWorkerAnomaly(
            `renderWorker が応答を返さずに終了しました (exit code ${code})`,
          ),
        ),
      );
    });

    worker.postMessage(job);

    return Effect.sync(cleanup);
  }).pipe(
    Effect.timeoutFail({
      duration: `${timeoutMillis} millis`,
      onTimeout: () =>
        reportWorkerAnomaly(
          `renderWorker が ${timeoutMillis}ms 以内に応答しませんでした`,
        ),
    }),
  );
