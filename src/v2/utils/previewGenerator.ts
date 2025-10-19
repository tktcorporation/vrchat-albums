interface GeneratePreviewParams {
  worldName: string;
  imageBase64: string;
  players: { playerName: string }[] | null;
  showAllPlayers: boolean;
}

import { P, match } from 'ts-pattern';
import { extractDominantColorsFromBase64 } from './colorExtractor';
import { renderSvgToCanvas } from './svgToCanvas';

/**
 * プレイヤー名リストを SVG 用に整形する内部関数。
 * generatePreviewSvg からのみ呼び出される。
 */
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
  const { displayPlayers, remainingCount } = match(showAllPlayers)
    .with(true, () => ({
      displayPlayers: players,
      remainingCount: 0,
    }))
    .with(false, () => {
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

      return {
        displayPlayers: tempPlayers,
        remainingCount: players.length - tempPlayers.length,
      };
    })
    .exhaustive();

  // プレイヤー名を描画
  for (const player of displayPlayers) {
    const playerWidth =
      [...player.playerName].reduce((width, char) => {
        return width + (/[\u3000-\u9fff]/.test(char) ? 14 : 7);
      }, 0) + 20;

    const lineWrapping = match(currentLineWidth + playerWidth > maxLineWidth)
      .with(true, () => ({
        x: 0,
        y: y + 30, // 行間隔を小さく
        currentLineWidth: 0,
      }))
      .with(false, () => ({ x, y, currentLineWidth }))
      .exhaustive();

    x = lineWrapping.x;
    y = lineWrapping.y;
    currentLineWidth = lineWrapping.currentLineWidth;

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

  match({ showAllPlayers, remainingCount })
    .when(
      ({ showAllPlayers, remainingCount }) =>
        !showAllPlayers && remainingCount > 0,
      () => {
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
      },
    )
    .otherwise(() => {});

  // プレイヤーリストのコンテナを終了
  elements.push('</g>');

  // プレイヤーリストの高さを計算
  const height = y + 24;

  return {
    elements: `<g transform="translate(32, 500)">${elements.join('')}</g>`,
    height: height + 20,
  };
}

/**
 * 背景画像とプレイヤー情報からプレビュー用 SVG を生成する。
 * generatePreviewPng の下位処理として呼び出される。
 */
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
  const colors = await extractDominantColorsFromBase64(imageBase64);

  // showAllPlayersがfalseの場合は600px固定、trueの場合は動的に計算
  const totalHeight = match(showAllPlayers)
    .with(true, () => Math.max(600, 500 + playerListHeight + 24))
    .with(false, () => 600)
    .exhaustive();

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

/**
 * 生成した SVG を PNG 形式の Base64 文字列へ変換する。
 * PhotoCard などでプレビュー画像として利用される。
 */
export async function generatePreviewPng(
  params: GeneratePreviewParams,
): Promise<string> {
  const { svg, height } = await generatePreviewSvg(params);

  const canvas = await renderSvgToCanvas(svg, 800, height);
  return canvas.toDataURL('image/png').split(',')[1];
}
