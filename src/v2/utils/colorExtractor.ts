import { hslToRgb, rgbToHsl } from './colorUtils';

/**
 * 画像要素をキャンバスに描画し、そのピクセルデータを取得するヘルパー。
 * `extractDominantColors` からのみ利用される内部関数。
 */
function getPixelData(img: HTMLImageElement): ImageData {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');

  canvas.width = img.width;
  canvas.height = img.height;
  ctx.drawImage(img, 0, 0);

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function calcColors(data: Uint8ClampedArray, step: number) {
  const colorBuckets: { [key: string]: ColorBucket } = {};

  for (let i = 0; i < data.length; i += step) {
    const r = Math.floor(data[i] / 5) * 5;
    const g = Math.floor(data[i + 1] / 5) * 5;
    const b = Math.floor(data[i + 2] / 5) * 5;
    const alpha = data[i + 3] / 255;

    if (alpha < 0.5) continue;

    const hsl = rgbToHsl(r, g, b);
    const [, s, l] = hsl;

    if (s < 20 || l < 15 || l > 85) continue;

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
    // index.cssで定義されたprimary colorと一致させる
    // --primary: 240 75% 60%;
    const primaryRgb = hslToRgb(240, 75, 60);
    const secondaryRgb = hslToRgb(220, 5, 96); // --secondary: 220 5% 96%
    const accentRgb = hslToRgb(240, 30, 95); // --accent: 240 30% 95%

    return {
      primary: `rgb(${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b})`,
      secondary: `rgb(${secondaryRgb.r}, ${secondaryRgb.g}, ${secondaryRgb.b})`,
      accent: `rgb(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b})`,
    };
  }

  const hueGroups: { [key: number]: ColorBucket[] } = {};
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

  const primary = hueGroupsArray[0]?.[0] || sortedColors[0];
  const secondary =
    hueGroupsArray[1]?.[0] || sortedColors[Math.floor(sortedColors.length / 3)];
  const accent =
    hueGroupsArray[2]?.[0] || sortedColors[Math.floor(sortedColors.length / 2)];

  return {
    primary: `rgb(${primary.r}, ${primary.g}, ${primary.b})`,
    secondary: `rgb(${secondary.r}, ${secondary.g}, ${secondary.b})`,
    accent: `rgb(${accent.r}, ${accent.g}, ${accent.b})`,
  };
}

interface ColorBucket {
  r: number;
  g: number;
  b: number;
  count: number;
  hsl: [number, number, number];
}

/**
 * 与えられた画像から主要な色を抽出する関数。
 *
 * @param img - 色を抽出する画像要素
 * @returns primary, secondary, accent の色を含むオブジェクト
 *
 * @description
 * VRChatワールド参加イベントのプレビュー画像生成で使用される。
 * 画像から支配的な色を抽出し、プレビューの装飾に利用する。
 *
 * 使用箇所:
 * - BoldPreview.tsx (src/v2/components/BoldPreview.tsx) - 共有用SVGプレビュー
 * - previewGenerator.ts (src/v2/utils/previewGenerator.ts) - PNG画像生成
 *
 * 色の用途:
 * - primary/secondary: 背景のグラデーションオーバーレイ
 * - accent: ワールド名の下のアンダーライン
 *
 * 色が抽出できない場合は、index.cssで定義されたテーマカラーと一致する
 * デフォルト値を返す。
 */
export function extractDominantColors(img: HTMLImageElement) {
  const imageData = getPixelData(img);
  return calcColors(imageData.data, 4);
}
