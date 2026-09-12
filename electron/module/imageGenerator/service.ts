import { Effect } from 'effect';

import type { ImageGenerationError } from './errors';
import { loadFonts } from './renderSvg';
import { runInWorker } from './workerClient';

/**
 * Share プレビュー画像を生成する（PNG base64）
 *
 * 処理フロー: フォント解決(Main) → worker_threads へジョブ委譲
 *   → 色抽出 → SVG テンプレート生成 → PNG レンダリング(worker) → base64 変換
 *
 * フォント解決は Electron API (`app.isPackaged` 等) に依存するため Main 側で行い、
 * 解決済みパスのみを worker に渡す。それ以降の CPU バウンドな処理は
 * Main プロセスの応答性を保つため worker_threads に完全にオフロードする
 * (ADR-005: docs/adr/005-main-process-cpu-bound-worker-offload.md)。
 *
 * 呼び出し元: ShareDialog から tRPC の query として呼ばれる
 */
export const generateSharePreview = (params: {
  worldName: string;
  imageBase64: string;
  players: { playerName: string }[] | null;
  showAllPlayers: boolean;
}): Effect.Effect<string, ImageGenerationError> =>
  Effect.gen(function* () {
    const fontFilePaths = yield* loadFonts();
    const pngBuffer = yield* runInWorker({
      outputFormat: 'png',
      worldName: params.worldName,
      imageBase64: params.imageBase64,
      players: params.players,
      showAllPlayers: params.showAllPlayers,
      fontFilePaths,
    });
    return pngBuffer.toString('base64');
  });

/**
 * World Join 画像を生成する（JPEG バッファ）
 *
 * 背景: ワールド参加時に自動生成される記録用画像。
 * プレイヤーは全員表示（showAllPlayers 固定 true）で、
 * 省略表示なしの完全なプレイヤーリストを含む。
 *
 * 呼び出し元: worldJoinImage/service.ts から呼ばれる
 */
export const generateWorldJoinImage = (params: {
  worldName: string;
  imageBase64: string;
  players: { playerName: string }[] | null;
  /** 現在は未使用。将来的に画像内に日時を表示する際に使用予定。 */
  joinDateTime: Date;
}): Effect.Effect<Buffer, ImageGenerationError> =>
  Effect.gen(function* () {
    const fontFilePaths = yield* loadFonts();
    return yield* runInWorker({
      outputFormat: 'jpeg',
      worldName: params.worldName,
      imageBase64: params.imageBase64,
      players: params.players,
      fontFilePaths,
      jpegQuality: 85,
    });
  });
