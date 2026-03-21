import type * as neverthrow from 'neverthrow';

import { extractDominantColorsFromBuffer } from './colorExtractor';
import type { ImageGenerationError } from './error';
import { renderSvgToJpeg, renderSvgToPng } from './renderSvg';
import { generatePreviewSvg } from './svgTemplate';

/**
 * Share プレビュー画像を生成する（PNG base64）
 *
 * 背景: 既存の Renderer ベース generatePreviewPng の置き換え。
 * Main プロセスで完結する画像生成パイプラインを構成し、
 * Canvas API への依存を排除する。
 *
 * 処理フロー: 色抽出 → SVG テンプレート生成 → PNG レンダリング → base64 変換
 *
 * 呼び出し元: ShareDialog から tRPC 経由で呼ばれる
 */
export const generateSharePreview = async (params: {
  worldName: string;
  imageBase64: string;
  players: { playerName: string }[] | null;
  showAllPlayers: boolean;
}): Promise<neverthrow.Result<string, ImageGenerationError>> => {
  const imageBuffer = Buffer.from(params.imageBase64, 'base64');
  const colors = await extractDominantColorsFromBuffer(imageBuffer);

  const { svg } = generatePreviewSvg({
    ...params,
    colors,
  });

  const pngResult = await renderSvgToPng(svg);
  return pngResult.map((buf) => buf.toString('base64'));
};

/**
 * World Join 画像を生成する（JPEG バッファ）
 *
 * 背景: ワールド参加時に自動生成される記録用画像。
 * プレイヤーは全員表示（showAllPlayers 固定 true）で、
 * 省略表示なしの完全なプレイヤーリストを含む。
 *
 * 処理フロー: 色抽出 → SVG テンプレート生成 → JPEG レンダリング
 *
 * 呼び出し元: worldJoinImage/service.ts から呼ばれる
 */
export const generateWorldJoinImage = async (params: {
  worldName: string;
  imageBase64: string;
  players: { playerName: string }[] | null;
  /** 現在は未使用。将来的に画像内に日時を表示する際に使用予定。 */
  joinDateTime: Date;
}): Promise<neverthrow.Result<Buffer, ImageGenerationError>> => {
  const imageBuffer = Buffer.from(params.imageBase64, 'base64');
  const colors = await extractDominantColorsFromBuffer(imageBuffer);

  const { svg } = generatePreviewSvg({
    worldName: params.worldName,
    imageBase64: params.imageBase64,
    players: params.players,
    showAllPlayers: true,
    colors,
  });

  return renderSvgToJpeg(svg, 85);
};
