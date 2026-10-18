import { measureNaturalWidth, prepareWithSegments } from '@chenglou/pretext';

/**
 * プレイヤーリスト表示で使用するフォント指定。
 *
 * 背景: LocationGroupHeader のプレイヤーリストは text-xs (12px) で描画される。
 * tailwind.config.js の fontFamily.sans と一致させる必要がある。
 * Canvas font shorthand 形式で指定（pretext 内部で Canvas.measureText に渡される）。
 */
export const PLAYER_LIST_FONT =
  "12px 'Noto Sans CJK JP', 'Noto Sans JP', sans-serif";

/**
 * フォント指定からピクセルサイズを抽出する。
 * Canvas font shorthand（例: "12px ...", "500 14px ..."）からサイズ部分を取り出す。
 */
function parseFontSizePx(font: string): number {
  const match = font.match(/(\d+(?:\.\d+)?)px/);
  return match ? Number.parseFloat(match[1]) : 14;
}

/**
 * Canvas 非対応環境用のフォールバック幅推定。
 * CJK 文字は全角幅、ASCII は半角幅として概算する。
 *
 * 背景: jsdom 等 Canvas のない環境で pretext がクラッシュするため。
 * Electron（Chromium）本番環境では使われない。
 */
function estimateTextWidth(text: string, font: string): number {
  const fontSize = parseFontSizePx(font);
  // Intl.Segmenter でグラフェムクラスタ単位に分割（絵文字の分断を防ぐ）
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  let width = 0;
  for (const { segment } of segmenter.segment(text)) {
    // CJK 統合漢字 + ひらがな + カタカナ + 全角記号
    const isCjk = /[\u3000-\u9FFF\uF900-\uFAFF]/.test(segment);
    width += isCjk ? fontSize : fontSize * 0.6;
  }
  return width;
}

/**
 * Canvas ベースのテキスト幅計測。DOM リフローを発生させない。
 *
 * 背景: getBoundingClientRect() はレイアウトエンジンを同期的に走らせる（layout thrashing）。
 * pretext は Canvas.measureText を使い、DOM に一切触れずにテキスト幅を返す。
 * Canvas 非対応環境（jsdom テスト等）では文字幅推定にフォールバックする。
 *
 * @param text - 計測対象のテキスト
 * @param font - Canvas font shorthand（例: "12px 'Noto Sans JP', sans-serif"）
 */
export function measureTextWidth(text: string, font: string): number {
  // effect-lint-allow-try-catch: Canvas 非対応環境の検出は Effect 化不要（同期・環境依存フォールバック）
  try {
    const prepared = prepareWithSegments(text, font);
    return measureNaturalWidth(prepared);
  } catch {
    // Canvas 非対応環境（jsdom 等）: 文字幅推定にフォールバック
    return estimateTextWidth(text, font);
  }
}

/**
 * コンテナ幅に収まるプレイヤー数を算出する純粋関数。
 *
 * 背景: usePlayerListDisplay でプレイヤーリストの表示数を決定するために使用。
 * テキスト計測関数を注入可能にしてテスタビリティを確保。
 *
 * @param playerNames - プレイヤー名の配列
 * @param containerWidth - コンテナの幅（px）
 * @param measureFn - テキスト幅を返す関数（pretext or mock）
 * @param options.separatorWidth - 区切り文字「/」の幅（デフォルト 24px）
 * @param options.moreTextWidth - 「/ +N」テキストの幅（デフォルト 48px）
 * @param options.minVisible - 最低表示数（デフォルト 3）
 */
export function calculateVisiblePlayerCount(
  playerNames: string[],
  containerWidth: number,
  measureFn: (text: string) => number,
  options?: {
    separatorWidth?: number;
    moreTextWidth?: number;
    minVisible?: number;
  },
): number {
  const {
    separatorWidth = 24,
    moreTextWidth = 48,
    minVisible = 3,
  } = options ?? {};

  let totalWidth = 0;
  let maxPlayers = 0;

  for (let i = 0; i < playerNames.length; i++) {
    const nameWidth = measureFn(playerNames[i]);
    const isLast = i === playerNames.length - 1;
    const widthWithSeparator = nameWidth + (isLast ? 0 : separatorWidth);

    // 残りプレイヤーがいる場合は "+N" テキスト分のスペースも確保する
    const reservedWidth = isLast ? 0 : moreTextWidth;

    if (totalWidth + widthWithSeparator + reservedWidth > containerWidth) {
      break;
    }

    totalWidth += widthWithSeparator;
    maxPlayers = i + 1;
  }

  return Math.max(minVisible, maxPlayers);
}
