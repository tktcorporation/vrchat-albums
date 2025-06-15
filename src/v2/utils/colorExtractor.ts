import {
  type DominantColors,
  extractDominantColorsFromImageData,
} from './dominantColor';

/**
 * 画像要素をキャンバスに描画し、そのピクセルデータを取得するヘルパー。
 * `extractDominantColors` からのみ利用される内部関数。
 */
function getPixelData(img: HTMLImageElement): ImageData {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');

  canvas.width = img.width;
  canvas.height = img.height;
  ctx.drawImage(img, 0, 0);

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * 与えられた画像から主要な色を抽出する関数。
 * `BoldPreview` や `previewGenerator` で背景色を決定するために使われる。
 */
export function extractDominantColors(img: HTMLImageElement): DominantColors {
  const imageData = getPixelData(img);
  return extractDominantColorsFromImageData(imageData.data);
}
