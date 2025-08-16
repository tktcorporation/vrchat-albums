#!/usr/bin/env tsx

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type Platform = 'win' | 'mac' | 'linux';

/**
 * SVGを読み込んで、プラットフォーム用に変換する
 */
function transformSvgForPlatform(
  svgContent: string,
  platform: Platform,
): string {
  let transformedContent = svgContent;

  if (platform === 'mac') {
    // macOS用: 要素を80%にスケールして中央配置
    // viewBoxは同じ、内部要素を変換

    // 背景のrectを80%サイズに変換（1024 -> 820, offset 102）
    transformedContent = transformedContent.replace(
      /<rect x="0" y="0" width="1024" height="1024" rx="234"/g,
      '<rect x="102" y="102" width="820" height="820" rx="187"',
    );

    // ハイライトのrectも調整
    transformedContent = transformedContent.replace(
      /<rect x="0" y="0" width="1024" height="512" rx="234"/g,
      '<rect x="102" y="102" width="820" height="410" rx="187"',
    );

    // キャラクターのスケールを調整（2.7 -> 2.16 = 80%）
    transformedContent = transformedContent.replace(
      /scale\(2\.7\)/g,
      'scale(2.16)',
    );

    // コメントを更新
    transformedContent = transformedContent.replace(
      /<!-- メイン背景（角丸とシャドウ） - Windows用フルサイズ -->/g,
      '<!-- メイン背景（角丸とシャドウ） - macOS用80%サイズ -->',
    );
  }
  // Windows/Linux用はそのまま使用

  return transformedContent;
}

/**
 * プラットフォーム用のアイコンを生成
 */
async function generatePlatformIcon(platform: Platform): Promise<void> {
  const sourceSvgPath = path.join(__dirname, '..', 'assets', 'icon.svg');
  const outputSvgPath = path.join(
    __dirname,
    '..',
    'assets',
    `icon-${platform}.svg`,
  );
  const outputPngPath = path.join(
    __dirname,
    '..',
    'assets',
    `icon-${platform}.png`,
  );

  console.log(`🎨 Generating ${platform.toUpperCase()} icon...`);

  try {
    // 元のSVGを読み込み
    let svgContent = fs.readFileSync(sourceSvgPath, 'utf-8');

    // プラットフォーム用に変換
    svgContent = transformSvgForPlatform(svgContent, platform);

    // 変換したSVGを保存
    fs.writeFileSync(outputSvgPath, svgContent);
    console.log(`  ✅ SVG saved: ${outputSvgPath}`);

    // SVGからPNGを生成
    const svgBuffer = Buffer.from(svgContent);
    await sharp(svgBuffer).resize(1024, 1024).png().toFile(outputPngPath);

    // ファイルサイズを表示
    const stats = fs.statSync(outputPngPath);
    const fileSizeInKB = (stats.size / 1024).toFixed(2);
    console.log(`  ✅ PNG saved: ${outputPngPath} (${fileSizeInKB} KB)`);
  } catch (error) {
    console.error(`❌ Error generating ${platform.toUpperCase()} icon:`, error);
    process.exit(1);
  }
}

/**
 * メイン処理
 */
async function main(): Promise<void> {
  const sourceSvgPath = path.join(__dirname, '..', 'assets', 'icon.svg');

  // 元のSVGファイルが存在するか確認
  if (!fs.existsSync(sourceSvgPath)) {
    console.error('❌ Error: assets/icon.svg not found!');
    console.error('Please create the source icon file first.');
    process.exit(1);
  }

  console.log('🚀 Generating platform-specific icons from icon.svg\n');

  // 各プラットフォーム用のアイコンを生成
  const platforms: Platform[] = ['win', 'mac', 'linux'];

  for (const platform of platforms) {
    await generatePlatformIcon(platform);
    console.log('');
  }

  // 汎用アイコンも生成（互換性のため）
  console.log('📦 Generating generic icon.png...');
  const svgBuffer = fs.readFileSync(sourceSvgPath);
  await sharp(svgBuffer)
    .resize(1024, 1024)
    .png()
    .toFile(path.join(__dirname, '..', 'assets', 'icon.png'));

  console.log('✨ All icons generated successfully!');
  console.log('\n📝 Note: All icons are generated from assets/icon.svg');
  console.log('   To update icons, modify icon.svg and run this script again.');
}

// 実行
main().catch((error: Error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
