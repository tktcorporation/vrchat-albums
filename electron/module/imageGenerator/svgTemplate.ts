import { match } from 'ts-pattern';

/** SVG/XML 特殊文字をエスケープする（インジェクション防止） */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** rgb(N, N, N) 形式の色文字列であることを検証する（SVG 属性インジェクション防止） */
const RGB_COLOR_PATTERN = /^rgb\(\d{1,3}, \d{1,3}, \d{1,3}\)$/;

function assertValidRgbColor(color: string): string {
  if (!RGB_COLOR_PATTERN.test(color)) {
    throw new Error(`Invalid color format: ${color}`);
  }
  return color;
}

/** base64 文字列であることを検証する（data URI インジェクション防止） */
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

function assertValidBase64(value: string): string {
  if (!BASE64_PATTERN.test(value)) {
    throw new Error('Invalid base64 string');
  }
  return value;
}

/**
 * プレイヤー名の表示幅を推定する。
 * CJK 文字は 14px 幅、ASCII 文字は 7px 幅として計算し、パディング 20px を加算。
 */
function estimatePlayerNameWidth(playerName: string): number {
  const nameWidth = Array.from(playerName).reduce((width, char) => {
    return width + (/[\u3000-\u9fff]/.test(char) ? 14 : 7);
  }, 0);
  return nameWidth + 20;
}

/**
 * SVG テンプレート生成に必要なパラメータ。
 *
 * 背景: Renderer プロセスの previewGenerator.ts から移植。
 * 元の実装では内部で extractDominantColorsFromBase64 を呼び出していたが、
 * Main プロセス版では呼び出し元が色を事前抽出して渡す設計に変更。
 * これにより SVG 生成が純粋関数となり、テストが容易になる。
 */
interface GeneratePreviewSvgParams {
  worldName: string;
  imageBase64: string;
  players: { playerName: string }[] | null;
  showAllPlayers: boolean;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
  };
}

/**
 * プレイヤー名リストを SVG 要素として整形する。
 *
 * 背景: プレイヤー名をバッジ形式で横並びに配置し、
 * 2行を超える場合は "+N more" で省略表示する。
 * generatePreviewSvg の下位処理として呼び出される。
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

  // プレイヤーリストのコンテナを開始（間隔を24pxに設定）
  elements.push('<g transform="translate(0, 22)">');

  let x = 0;
  let y = 0;
  let currentLineWidth = 0;
  const maxLineWidth = 740;

  /**
   * プレイヤー名の表示幅を推定する。
   * CJK文字は14px幅、ASCII文字は7px幅として計算し、パディング20pxを加算。
   */
  const playerWidths = players.map((player) =>
    estimatePlayerNameWidth(player.playerName),
  );

  // 表示するプレイヤーを決定
  const { displayPlayers, remainingCount } = match(showAllPlayers)
    .with(true, () => ({
      displayPlayers: players,
      remainingCount: 0,
    }))
    .with(false, () => {
      // +N moreの固定幅を事前に設定
      const moreFixedWidth = 100;
      const availableWidth = maxLineWidth - moreFixedWidth;

      // プレイヤーを2行に配置していく
      const tempPlayers: typeof players = [];
      let currentWidth = 0;
      let isSecondRow = false;

      for (const [index, width] of playerWidths.entries()) {
        const effectiveWidth = isSecondRow ? availableWidth : maxLineWidth;

        if (currentWidth + width <= effectiveWidth) {
          tempPlayers.push(players[index]);
          currentWidth += width + 6;
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
    const playerWidth = estimatePlayerNameWidth(player.playerName);

    const lineWrapping = match(currentLineWidth + playerWidth > maxLineWidth)
      .with(true, () => ({
        x: 0,
        y: y + 30,
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
        >${escapeXml(player.playerName)}</text>
      </g>
    `);

    x += playerWidth + 6;
    currentLineWidth += playerWidth + 6;
  }

  // showAllPlayers=false かつ残りプレイヤーがいる場合のみ "+N more" バッジを表示
  if (!showAllPlayers && remainingCount > 0) {
    const moreText = `+${remainingCount} more`;
    const moreTextWidth = Array.from(moreText).reduce((width, char) => {
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

/**
 * 背景画像とプレイヤー情報からプレビュー用 SVG を生成する。
 *
 * 背景: Renderer プロセスの previewGenerator.ts から移植した純粋関数版。
 * 元の実装では内部で色抽出を行っていたが、この版では colors パラメータとして受け取る。
 * renderSvgToPng と組み合わせて Main プロセスで完結する画像生成パイプラインを構成する。
 *
 * SVG テンプレートの構成:
 * - 背景: ワールド画像（ぼかし + カラーオーバーレイグラデーション）
 * - 中央: ワールド画像（角丸クリップ）
 * - 上部: ワールド名テキスト + アクセントアンダーライン
 * - 下部: プレイヤー名バッジ（"+N more" 省略表示付き）
 */
export function generatePreviewSvg({
  worldName,
  imageBase64,
  players,
  showAllPlayers,
  colors,
}: GeneratePreviewSvgParams): { svg: string; height: number } {
  // SVG 属性インジェクション防止: 外部由来の値をバリデーション
  const safePrimary = assertValidRgbColor(colors.primary);
  const safeSecondary = assertValidRgbColor(colors.secondary);
  const safeAccent = assertValidRgbColor(colors.accent);
  const safeImageBase64 = assertValidBase64(imageBase64);

  const headerFontSize = '20px';
  const subHeaderFontSize = '14px';

  const { elements: playerElements, height: playerListHeight } =
    generatePlayerElements(players, showAllPlayers, subHeaderFontSize);

  // showAllPlayersがfalseの場合は600px固定、trueの場合は動的に計算
  const totalHeight = match(showAllPlayers)
    .with(true, () => Math.max(600, 500 + playerListHeight + 24))
    .with(false, () => 600)
    .exhaustive();

  // 中央の画像エリアを736x414に設定
  const imageWidth = 736;
  const imageHeight = 414;
  const imageX = Math.round((800 - imageWidth) / 2);
  const imageY = 70;

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
            href="data:image/png;base64,${safeImageBase64}"
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
            href="data:image/png;base64,${safeImageBase64}"
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
          <stop offset="0%" stop-color="${safePrimary}" stop-opacity="0.4" />
          <stop offset="100%" stop-color="${safeSecondary}" stop-opacity="0.4" />
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
          ${escapeXml(worldName)}
        </text>
        <rect
          x="0"
          y="28"
          width="200"
          height="3"
          rx="1.5"
          fill="${safeAccent}"
        />
      </g>

      ${playerElements}
    </svg>`;

  return { svg, height: totalHeight };
}
