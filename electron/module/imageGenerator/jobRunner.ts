import { Effect } from 'effect';
import { match } from 'ts-pattern';

import { extractDominantColorsFromBuffer } from './colorExtractor';
import type { ImageGenerationError } from './errors';
import { renderSvgToJpeg, renderSvgToPng } from './renderSvg';
import { generatePreviewSvg } from './svgTemplate';

/**
 * 画像生成ジョブの入力。
 *
 * worker_threads の postMessage で構造化クローンされるため、
 * 関数やクラスインスタンスを含まないプレーンな値のみで構成する。
 * fontFilePaths は Main プロセス側で loadFonts() により事前解決した値を渡す
 * (このモジュールは Electron API に依存しない純粋な計算として設計されている)。
 */
export type ImageGenerationJob =
  | {
      outputFormat: 'png';
      worldName: string;
      imageBase64: string;
      players: { playerName: string }[] | null;
      showAllPlayers: boolean;
      fontFilePaths: string[];
    }
  | {
      outputFormat: 'jpeg';
      worldName: string;
      imageBase64: string;
      players: { playerName: string }[] | null;
      fontFilePaths: string[];
      jpegQuality: number;
    };

/**
 * 画像生成パイプライン本体（色抽出 → SVG テンプレート生成 → レンダリング）。
 *
 * 背景: Main プロセスのイベントループを専有しないよう、この関数は
 * renderWorker.ts から worker_threads 上で実行される想定で設計している
 * (ADR-005: docs/adr/005-main-process-cpu-bound-worker-offload.md)。
 * Electron API に一切依存しないため、Main プロセスからも
 * ユニットテストからも同一のロジックとして呼び出せる。
 */
export const runImageGenerationJob = (
  job: ImageGenerationJob,
): Effect.Effect<Buffer, ImageGenerationError> =>
  Effect.gen(function* () {
    const imageBuffer = Buffer.from(job.imageBase64, 'base64');
    const colors = yield* Effect.promise(() =>
      extractDominantColorsFromBuffer(imageBuffer),
    );

    return yield* match(job)
      .with({ outputFormat: 'png' }, (pngJob) => {
        const { svg } = generatePreviewSvg({
          worldName: pngJob.worldName,
          imageBase64: pngJob.imageBase64,
          players: pngJob.players,
          showAllPlayers: pngJob.showAllPlayers,
          colors,
        });
        return renderSvgToPng(svg, pngJob.fontFilePaths);
      })
      .with({ outputFormat: 'jpeg' }, (jpegJob) => {
        const { svg } = generatePreviewSvg({
          worldName: jpegJob.worldName,
          imageBase64: jpegJob.imageBase64,
          players: jpegJob.players,
          showAllPlayers: true,
          colors,
        });
        return renderSvgToJpeg(svg, jpegJob.fontFilePaths, jpegJob.jpegQuality);
      })
      .exhaustive();
  });
