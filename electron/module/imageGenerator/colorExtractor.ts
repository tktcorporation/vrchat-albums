import { Transformer } from '@napi-rs/image';

import { hslToRgb, rgbToHsl } from '../../lib/colorUtils';

/**
 * 画像バッファから抽出された主要3色。
 *
 * 用途: ワールド参加イベントのプレビュー画像生成で、
 * 背景グラデーション（primary/secondary）やアクセントライン（accent）に使用。
 */
export interface DominantColors {
  primary: string;
  secondary: string;
  accent: string;
}

interface ColorBucket {
  r: number;
  g: number;
  b: number;
  count: number;
  hsl: [number, number, number];
}

/**
 * index.css で定義されたテーマカラーに一致するデフォルト値。
 * 画像から有効な色が抽出できなかった場合に返す。
 */
const DEFAULT_COLORS: DominantColors = (() => {
  const primaryRgb = hslToRgb(240, 75, 60);
  const secondaryRgb = hslToRgb(220, 5, 96);
  const accentRgb = hslToRgb(240, 30, 95);
  return {
    primary: `rgb(${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b})`,
    secondary: `rgb(${secondaryRgb.r}, ${secondaryRgb.g}, ${secondaryRgb.b})`,
    accent: `rgb(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b})`,
  };
})();

/**
 * RGBAピクセルデータから主要な色を計算する。
 *
 * 背景: src/v2/utils/colorExtractor.ts の calcColors を
 * Canvas API なしで動作するようポートしたもの。
 * ロジックは同一で、ピクセルデータの取得方法のみ異なる。
 *
 * アルゴリズム:
 * 1. ピクセルを step 間隔でサンプリング（パフォーマンス最適化）
 * 2. RGB を 5 刻みで量子化してバケットに集約
 * 3. 低彩度・極端な明度の色をフィルタ
 * 4. 色相を 30 度バケットでグループ化
 * 5. 上位 3 グループの代表色を primary/secondary/accent として返す
 */
function calcColors(data: Buffer, step: number): DominantColors {
  const colorBuckets: Record<string, ColorBucket> = {};

  for (let i = 0; i < data.length; i += step) {
    const r = Math.floor(data[i] / 5) * 5;
    const g = Math.floor(data[i + 1] / 5) * 5;
    const b = Math.floor(data[i + 2] / 5) * 5;
    const alpha = data[i + 3] / 255;

    if (alpha < 0.5) {
      continue;
    }

    const hsl = rgbToHsl(r, g, b);
    const [, s, l] = hsl;

    // 低彩度や極端な明度の色はスキップ（背景や白/黒に近い色を除外）
    if (s < 20 || l < 15 || l > 85) {
      continue;
    }

    const key = `${r},${g},${b}`;

    if (colorBuckets[key]) {
      colorBuckets[key].count++;
    } else {
      colorBuckets[key] = { r, g, b, count: 1, hsl };
    }
  }

  const sortedColors = Object.values(colorBuckets)
    .toSorted((a, b) => b.count - a.count)
    .filter((bucket) => bucket.count > 20);

  if (sortedColors.length === 0) {
    return DEFAULT_COLORS;
  }

  // 色相を 30 度刻みでグループ化し、最も多い色相グループを優先
  const hueGroups: Record<number, ColorBucket[]> = {};
  for (const color of sortedColors) {
    const hueGroup = Math.floor(color.hsl[0] / 30);
    if (!hueGroups[hueGroup]) {
      hueGroups[hueGroup] = [];
    }
    hueGroups[hueGroup].push(color);
  }

  const hueGroupsArray = Object.values(hueGroups).toSorted(
    (a, b) => b[0].count - a[0].count,
  );

  const primary = hueGroupsArray[0]?.[0] ?? sortedColors[0];
  const secondary =
    hueGroupsArray[1]?.[0] ?? sortedColors[Math.floor(sortedColors.length / 3)];
  const accent =
    hueGroupsArray[2]?.[0] ?? sortedColors[Math.floor(sortedColors.length / 2)];

  return {
    primary: `rgb(${primary.r}, ${primary.g}, ${primary.b})`,
    secondary: `rgb(${secondary.r}, ${secondary.g}, ${secondary.b})`,
    accent: `rgb(${accent.r}, ${accent.g}, ${accent.b})`,
  };
}

/**
 * 画像バッファ（PNG/JPEG等）から主要な色を抽出する。
 *
 * 背景: src/v2/utils/colorExtractor.ts はブラウザ Canvas API に依存するため
 * Electron メインプロセスでは使用できない。この関数は @napi-rs/image の
 * Transformer を使って同等の処理を行う。
 *
 * 呼び出し元: imageGenerator サービス（ワールド参加プレビュー画像生成時）
 * 色が抽出できない場合はデフォルトのテーマカラーを返す（エラーにはならない）。
 *
 * @param imageBuffer - PNG/JPEG 等の画像バイナリ
 * @returns primary, secondary, accent の RGB 文字列
 */
export async function extractDominantColorsFromBuffer(
  imageBuffer: Buffer,
): Promise<DominantColors> {
  // effect-lint-allow-try-catch: 非Effectプレーン関数、破損画像時にデフォルトカラーを返す
  try {
    const transformer = new Transformer(imageBuffer);
    const rawPixels = await transformer.rawPixels();

    // RGBA: 4 bytes per pixel, sample every 20th pixel (step = 80 bytes)
    const step = 4 * 20;
    return calcColors(rawPixels, step);
  } catch {
    // 破損した画像や不正なフォーマットの場合はデフォルトカラーを返す
    return DEFAULT_COLORS;
  }
}
