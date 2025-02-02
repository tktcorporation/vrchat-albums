interface GeneratePreviewParams {
  worldName: string;
  imageBase64: string;
  players: { playerName: string }[] | null;
  showAllPlayers: boolean;
}

interface ColorBucket {
  r: number;
  g: number;
  b: number;
  count: number;
  hsl: [number, number, number];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const normalizedR = r / 255;
  const normalizedG = g / 255;
  const normalizedB = b / 255;

  const max = Math.max(normalizedR, normalizedG, normalizedB);
  const min = Math.min(normalizedR, normalizedG, normalizedB);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case normalizedR:
        h =
          (normalizedG - normalizedB) / d + (normalizedG < normalizedB ? 6 : 0);
        break;
      case normalizedG:
        h = (normalizedB - normalizedR) / d + 2;
        break;
      case normalizedB:
        h = (normalizedR - normalizedG) / d + 4;
        break;
    }

    h /= 6;
  }

  return [h * 360, s * 100, l * 100];
}

async function extractDominantColors(imageBase64: string): Promise<{
  primary: string;
  secondary: string;
  accent: string;
}> {
  // 画像を読み込む
  const img = new Image();
  img.src = `data:image/png;base64,${imageBase64}`;
  await new Promise<void>((resolve) => {
    img.onload = () => resolve();
  });

  // キャンバスを作成して画像を描画
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }
  ctx.drawImage(img, 0, 0);

  // ピクセルデータを取得
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  const colorBuckets: { [key: string]: ColorBucket } = {};

  // 5ピクセルごとにサンプリング（処理を軽くするため）
  for (let i = 0; i < data.length; i += 20) {
    const r = Math.floor(data[i] / 5) * 5;
    const g = Math.floor(data[i + 1] / 5) * 5;
    const b = Math.floor(data[i + 2] / 5) * 5;
    const alpha = data[i + 3] / 255;

    if (alpha < 0.5) continue;

    const hsl = rgbToHsl(r, g, b);
    const [, s, l] = hsl;

    // 彩度と明度でフィルタリング
    if (s < 20 || l < 15 || l > 85) continue;

    const key = `${r},${g},${b}`;

    if (colorBuckets[key]) {
      colorBuckets[key].count++;
    } else {
      colorBuckets[key] = { r, g, b, count: 1, hsl };
    }
  }

  // 出現頻度でソート
  const sortedColors = Object.values(colorBuckets)
    .sort((a, b) => b.count - a.count)
    .filter((bucket) => bucket.count > 20);

  // デフォルトの色
  const defaultColors = {
    primary: { r: 59, g: 130, b: 246 },
    secondary: { r: 147, g: 51, b: 234 },
    accent: { r: 79, g: 70, b: 229 },
  };

  if (sortedColors.length === 0) {
    return {
      primary: `rgb(${defaultColors.primary.r}, ${defaultColors.primary.g}, ${defaultColors.primary.b})`,
      secondary: `rgb(${defaultColors.secondary.r}, ${defaultColors.secondary.g}, ${defaultColors.secondary.b})`,
      accent: `rgb(${defaultColors.accent.r}, ${defaultColors.accent.g}, ${defaultColors.accent.b})`,
    };
  }

  // 色相でグループ化
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

function generatePlayerElements(
  players: { playerName: string }[] | null,
  showAllPlayers: boolean,
  subHeaderFontSize: string,
): { elements: string; height: number } {
  if (!players || players.length === 0) return { elements: '', height: 0 };

  const elements: string[] = [];

  // PLAYERSヘッダーを追加
  elements.push(`
    <g>
      <text
        x="0"
        y="0"
        font-size="${subHeaderFontSize}"
        font-weight="600"
        fill="rgba(255, 255, 255, 0.6)"
        dominant-baseline="hanging"
        letter-spacing="0.05em"
        filter="none"
      >
        PLAYERS (${players.length})
      </text>
    </g>
  `);

  // プレイヤーリストのコンテナを開始（間隔を20pxから24pxに広げる）
  elements.push(`<g transform="translate(0, 22)">`);

  let x = 0;
  let y = 0;
  let currentLineWidth = 0;
  const maxLineWidth = 740;

  // プレイヤー名の幅を事前計算（フォントサイズを12pxに変更したので、文字幅も調整）
  const playerWidths = players.map((player) => {
    const nameWidth = [...player.playerName].reduce((width, char) => {
      return width + (/[\u3000-\u9fff]/.test(char) ? 14 : 7);
    }, 0);
    return nameWidth + 20; // パディング込みの幅も小さく
  });

  // 表示するプレイヤーを決定
  let displayPlayers: typeof players;
  let remainingCount = 0;

  if (!showAllPlayers) {
    // +N moreの固定幅を事前に設定
    const moreFixedWidth = 100; // 小さくした分調整
    const availableWidth = maxLineWidth - moreFixedWidth;

    // プレイヤーを2行に配置していく
    const tempPlayers: typeof players = [];
    let currentWidth = 0;
    let isSecondRow = false;

    for (const [index, width] of playerWidths.entries()) {
      const effectiveWidth = isSecondRow ? availableWidth : maxLineWidth;

      if (currentWidth + width <= effectiveWidth) {
        tempPlayers.push(players[index]);
        currentWidth += width + 6; // 間隔も小さく
      } else if (!isSecondRow) {
        // 1行目が埋まったら2行目へ
        isSecondRow = true;
        currentWidth = width + 6;
        tempPlayers.push(players[index]);
      } else {
        // 2行目も埋まったら終了
        break;
      }
    }

    displayPlayers = tempPlayers;
    remainingCount = players.length - tempPlayers.length;
  } else {
    displayPlayers = players;
  }

  // プレイヤー名を描画
  for (const player of displayPlayers) {
    const playerWidth =
      [...player.playerName].reduce((width, char) => {
        return width + (/[\u3000-\u9fff]/.test(char) ? 14 : 7);
      }, 0) + 20;

    if (currentLineWidth + playerWidth > maxLineWidth) {
      x = 0;
      y += 30; // 行間隔を小さく
      currentLineWidth = 0;
    }

    elements.push(`
      <g transform="translate(${x}, ${y})">
        <rect
          width="${playerWidth}"
          height="24"
          rx="12"
          fill="rgba(0, 0, 0, 0.3)"
        />
        <text
          x="${playerWidth / 2}"
          y="12"
          font-size="12"
          font-weight="500"
          fill="rgba(255, 255, 255, 0.9)"
          text-anchor="middle"
          dominant-baseline="middle"
          filter="none"
        >${player.playerName}</text>
      </g>
    `);

    x += playerWidth + 6; // 間隔を小さく
    currentLineWidth += playerWidth + 6;
  }

  if (!showAllPlayers && remainingCount > 0) {
    const moreText = `+${remainingCount} more`;
    const moreTextWidth = [...moreText].reduce((width, char) => {
      return width + (/[\u3000-\u9fff]/.test(char) ? 14 : 7);
    }, 0);
    const moreWidth = moreTextWidth + 20;

    elements.push(`
      <g transform="translate(${x}, ${y})">
        <rect
          width="${moreWidth}"
          height="24"
          rx="12"
          fill="rgba(0, 0, 0, 0.3)"
        />
        <text
          x="${moreWidth / 2}"
          y="12"
          font-size="12"
          font-weight="500"
          fill="rgba(255, 255, 255, 0.9)"
          text-anchor="middle"
          dominant-baseline="middle"
          filter="none"
        >${moreText}</text>
      </g>
    `);
  }

  // プレイヤーリストのコンテナを終了
  elements.push('</g>');

  // プレイヤーリストの高さを計算
  const height = y + 24;

  return {
    elements: `<g transform="translate(32, 500)">${elements.join('')}</g>`,
    height: height + 20,
  };
}

async function generatePreviewSvg({
  worldName,
  imageBase64,
  players,
  showAllPlayers,
}: GeneratePreviewParams): Promise<{ svg: string; height: number }> {
  const headerFontSize = '20px';
  const subHeaderFontSize = '14px';

  const { elements: playerElements, height: playerListHeight } =
    generatePlayerElements(players, showAllPlayers, subHeaderFontSize);
  const colors = await extractDominantColors(imageBase64);

  // showAllPlayersがfalseの場合は600px固定、trueの場合は動的に計算
  const totalHeight = showAllPlayers
    ? Math.max(600, 500 + playerListHeight + 24)
    : 600;

  // 中央の画像エリアを736×414に設定
  const imageWidth = 736;
  const imageHeight = 414;
  const imageX = Math.round((800 - imageWidth) / 2); // 中央寄せ
  const imageY = 70; // 上部の余白を調整

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
    <svg
      viewBox="0 0 800 ${totalHeight}"
      xmlns="http://www.w3.org/2000/svg"
      style="background: #7FB5B5;"
    >
      <title>VRChat World Join Preview</title>
      <defs>
        <filter id="blur-effect">
          <feGaussianBlur stdDeviation="40" />
          <feColorMatrix type="saturate" values="1.2" />
        </filter>

        <filter id="soft-shadow">
          <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.3" />
        </filter>

        <pattern
          id="bg-image"
          patternUnits="userSpaceOnUse"
          width="800"
          height="${totalHeight}"
        >
          <image
            href="data:image/png;base64,${imageBase64}"
            x="-200"
            y="0"
            width="1200"
            height="${totalHeight}"
            preserveAspectRatio="xMidYMid slice"
          />
        </pattern>

        <pattern
          id="main-image"
          patternUnits="userSpaceOnUse"
          x="${imageX}"
          y="${imageY}"
          width="${imageWidth}"
          height="${imageHeight}"
        >
          <image
            href="data:image/png;base64,${imageBase64}"
            x="0"
            y="0"
            width="${imageWidth}"
            height="${imageHeight}"
            preserveAspectRatio="xMidYMid slice"
          />
        </pattern>

        <linearGradient
          id="overlay-gradient"
          x1="0"
          y1="0"
          x2="0"
          y2="${totalHeight}"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stop-color="${colors.primary}" stop-opacity="0.4" />
          <stop offset="100%" stop-color="${colors.secondary}" stop-opacity="0.4" />
        </linearGradient>
      </defs>

      <rect
        width="100%"
        height="100%"
        fill="url(#bg-image)"
        filter="url(#blur-effect)"
        opacity="0.8"
      />

      <rect
        width="100%"
        height="100%"
        fill="url(#overlay-gradient)"
      />

      <rect
        x="${imageX}"
        y="${imageY}"
        width="${imageWidth}"
        height="${imageHeight}"
        fill="url(#main-image)"
        rx="12"
      />

      <g transform="translate(32, 24)">
        <text
          x="0"
          y="0"
          font-size="${headerFontSize}"
          font-weight="700"
          fill="white"
          dominant-baseline="hanging"
          class="header"
        >
          ${worldName}
        </text>
        <rect
          x="0"
          y="28"
          width="200"
          height="3"
          rx="1.5"
          fill="${colors.accent}"
        />
      </g>

      ${playerElements}
    </svg>`;

  return { svg, height: totalHeight };
}

export async function generatePreviewPng(
  params: GeneratePreviewParams,
): Promise<string> {
  const { svg, height } = await generatePreviewSvg(params);

  // SVGをデータURLに変換
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    // フォントを読み込む
    await document.fonts.load('700 1em Inter');
    await document.fonts.load('600 1em Inter');
    await document.fonts.load('500 1em Inter');
    await document.fonts.load('400 1em Inter');

    // SVGをPNGに変換
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = svgUrl;
    await new Promise<void>((resolve) => {
      img.onload = () => resolve();
    });

    const canvas = document.createElement('canvas');
    canvas.width = 800 * 2; // 2倍のサイズで描画
    canvas.height = height * 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get canvas context');
    }

    // 背景を白に設定
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 画像を描画
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    return canvas.toDataURL('image/png').split(',')[1];
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}
