/**
 * UIコンポーネントで使用する共通定数を一元管理
 * デザイントークンとして一貫したスタイリングを提供
 */

// =============================================================================
// アイコンサイズ
// =============================================================================

/**
 * アイコンサイズの標準定義
 * Tailwindクラスとピクセルサイズの両方に対応
 */
export const ICON_SIZE = {
  /** 極小サイズ (12px) - バッジ等で使用 */
  xs: {
    class: 'h-3 w-3',
    pixels: 12,
  },
  /** 小サイズ (16px) - デフォルトサイズ */
  sm: {
    class: 'h-4 w-4',
    pixels: 16,
  },
  /** 中サイズ (20px) - ボタンアイコン等で使用 */
  md: {
    class: 'h-5 w-5',
    pixels: 20,
  },
  /** 大サイズ (32px) - ローディングアイコン等で使用 */
  lg: {
    class: 'h-8 w-8',
    pixels: 32,
  },
  /** 特大サイズ (24px) - PhotoCard専用 */
  photo: {
    class: 'h-6 w-6',
    pixels: 24,
  },
} as const;

export type IconSizeKey = keyof typeof ICON_SIZE;
export type IconSizeValue = (typeof ICON_SIZE)[IconSizeKey];

// =============================================================================
// スペーシング
// =============================================================================

/**
 * スペーシングスケール（4px基準）
 * 一貫した間隔でUIの統一感を確保
 */
export const SPACING = {
  /** 縦方向の間隔（space-y-*） */
  stack: {
    /** 4px - アイコンとテキストの間隔など */
    tight: 'space-y-1',
    /** 8px - フォーム要素間のデフォルト */
    default: 'space-y-2',
    /** 16px - セクション内の要素間 */
    relaxed: 'space-y-4',
    /** 24px - セクション間の大きな間隔 */
    loose: 'space-y-6',
  },
  /** 横方向の間隔（gap-*） */
  inline: {
    /** 4px - 密接した要素間 */
    tight: 'gap-1',
    /** 8px - ボタンやアイコン間のデフォルト */
    default: 'gap-2',
    /** 12px - ゆったりした配置 */
    relaxed: 'gap-3',
    /** 16px - 大きな要素間 */
    loose: 'gap-4',
  },
  /** パディング */
  padding: {
    /** カード内のパディング */
    card: 'p-4',
    /** セクション・モーダルのパディング */
    section: 'p-6',
    /** 小さいカード・アイテム */
    sm: 'p-2',
    /** 中サイズのコンテナ */
    md: 'p-3',
  },
} as const;

export type SpacingStackKey = keyof typeof SPACING.stack;
export type SpacingInlineKey = keyof typeof SPACING.inline;
export type SpacingPaddingKey = keyof typeof SPACING.padding;

// =============================================================================
// タイポグラフィ
// =============================================================================

/**
 * タイポグラフィスケール
 * 見出し・本文・キャプションの階層を明確化
 */
export const TYPOGRAPHY = {
  /** 見出しスタイル */
  heading: {
    /** ページタイトル（24px, bold） */
    page: 'text-2xl font-bold',
    /** セクション見出し（18px, semibold） */
    section: 'text-lg font-semibold',
    /** サブセクション・カードタイトル（16px, medium） */
    subsection: 'text-base font-medium',
    /** フォームラベル（14px, medium） */
    label: 'text-sm font-medium',
  },
  /** 本文スタイル */
  body: {
    /** デフォルト本文（14px） */
    default: 'text-sm',
    /** 小さい本文（12px） */
    small: 'text-xs',
    /** 強調本文（14px, medium） */
    emphasis: 'text-sm font-medium',
  },
  /** キャプション・補助テキスト */
  caption: {
    /** 通常キャプション（12px, muted） */
    default: 'text-xs text-muted-foreground',
    /** メタ情報（タイムスタンプ等） */
    meta: 'text-xs text-muted-foreground/60',
  },
} as const;

export type TypographyHeadingKey = keyof typeof TYPOGRAPHY.heading;
export type TypographyBodyKey = keyof typeof TYPOGRAPHY.body;
export type TypographyCaptionKey = keyof typeof TYPOGRAPHY.caption;

// =============================================================================
// テキストカラー
// =============================================================================

/**
 * セマンティックテキストカラー
 * gray-XXXの直接指定を避け、意味のある名前で統一
 *
 * 移行マッピング:
 * - text-gray-900 dark:text-white → TEXT_COLOR.primary
 * - text-gray-700 dark:text-gray-300 → TEXT_COLOR.secondary
 * - text-gray-500 dark:text-gray-400 → TEXT_COLOR.muted
 * - text-indigo-600 dark:text-indigo-400 → TEXT_COLOR.accent
 */
export const TEXT_COLOR = {
  /** 主要テキスト（見出し、重要な情報） */
  primary: 'text-foreground',
  /** 二次テキスト（説明文、サブ情報） */
  secondary: 'text-muted-foreground',
  /** 控えめなテキスト（プレースホルダー、ヒント） */
  muted: 'text-muted-foreground/60',
  /** アクセントカラー（リンク、強調） */
  accent: 'text-primary',
  /** 反転テキスト（ボタン上など） */
  inverse: 'text-primary-foreground',
} as const;

export type TextColorKey = keyof typeof TEXT_COLOR;

// =============================================================================
// サーフェスカラー（背景）
// =============================================================================

/**
 * 背景・サーフェスカラー
 * gray-XXXの直接指定を避け、意味のある名前で統一
 *
 * 移行マッピング:
 * - bg-gray-50 dark:bg-gray-900 → SURFACE_COLOR.default
 * - bg-gray-100 dark:bg-gray-800 → SURFACE_COLOR.muted
 * - bg-white dark:bg-gray-800 → SURFACE_COLOR.card
 */
export const SURFACE_COLOR = {
  /** デフォルト背景 */
  default: 'bg-background',
  /** 控えめな背景（セクション区切りなど） */
  muted: 'bg-muted',
  /** カード背景 */
  card: 'bg-card',
  /** ポップオーバー・ドロップダウン背景 */
  popover: 'bg-popover',
  /** Glass morphism背景 */
  glass: 'bg-glass backdrop-blur-md',
  /** 半透明の控えめ背景 */
  subtle: 'bg-muted/40',
} as const;

export type SurfaceColorKey = keyof typeof SURFACE_COLOR;

// =============================================================================
// ステータスカラー
// =============================================================================

/**
 * ステータス表示用カラーセット
 * 成功・警告・エラー・情報の4種類を統一的に提供
 */
export const STATUS_COLOR = {
  success: {
    bg: 'bg-green-100 dark:bg-green-900/20',
    text: 'text-green-800 dark:text-green-200',
    border: 'border-green-200 dark:border-green-800',
  },
  warning: {
    bg: 'bg-yellow-100 dark:bg-yellow-900/20',
    text: 'text-yellow-800 dark:text-yellow-200',
    border: 'border-yellow-200 dark:border-yellow-800',
  },
  error: {
    bg: 'bg-destructive/10',
    text: 'text-destructive',
    border: 'border-destructive/30',
  },
  info: {
    bg: 'bg-primary/10',
    text: 'text-primary',
    border: 'border-primary/30',
  },
} as const;

export type StatusColorKey = keyof typeof STATUS_COLOR;

// =============================================================================
// ボーダー
// =============================================================================

/**
 * ボーダースタイル
 * opacity値の統一とセマンティックな命名
 */
export const BORDER = {
  /** 標準ボーダー */
  default: 'border border-border',
  /** 控えめなボーダー（セパレーターなど） */
  subtle: 'border border-border/30',
  /** 中程度のボーダー */
  muted: 'border border-border/50',
  /** Glass morphism用ボーダー */
  glass: 'border border-glass-border',
  /** インタラクティブ要素用 */
  interactive: 'border border-input hover:border-input/80',
  /** 水平方向のディバイダー */
  dividerX: 'border-t border-border/30',
  /** 垂直方向のディバイダー */
  dividerY: 'border-l border-border/30',
} as const;

export type BorderKey = keyof typeof BORDER;
