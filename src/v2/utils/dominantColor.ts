/**
 * HSL値と支配色を算得するための共通ユーティリティファイル
 */
export interface DominantColors {
  primary: string;
  secondary: string;
  accent: string;
}

export const DEFAULT_COLORS: DominantColors = {
  primary: 'rgb(59, 130, 246)',
  secondary: 'rgb(147, 51, 234)',
  accent: 'rgb(79, 70, 229)',
};

/**
 * RGB 値を HSL 値に変換する
 */
export function rgbToHsl(
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;

  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case rNorm:
        h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0);
        break;
      case gNorm:
        h = (bNorm - rNorm) / d + 2;
        break;
      case bNorm:
        h = (rNorm - gNorm) / d + 4;
        break;
    }

    h /= 6;
  }

  return [h * 360, s * 100, l * 100];
}

/**
 * ImageData から支配色を抽出する
 * @param data ImageData.data の配列
 * @param step RGBAデータを例えば 4 で元のピクセルごとに読み込む
 */
export function extractDominantColorsFromImageData(
  data: Uint8ClampedArray,
  step = 4,
): DominantColors {
  interface ColorBucket {
    r: number;
    g: number;
    b: number;
    count: number;
    hsl: [number, number, number];
  }

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
    .sort((a, b) => b.count - a.count)
    .filter((bucket) => bucket.count > 20);

  if (sortedColors.length === 0) {
    return DEFAULT_COLORS;
  }

  const hueGroups: { [key: number]: ColorBucket[] } = {};
  for (const color of sortedColors) {
    const hueGroup = Math.floor(color.hsl[0] / 30);
    if (!hueGroups[hueGroup]) {
      hueGroups[hueGroup] = [];
    }
    hueGroups[hueGroup].push(color);
  }

  const hueGroupsArray = Object.values(hueGroups).sort(
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
