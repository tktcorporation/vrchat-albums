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
 * スペーシングスケール（8pxベース）
 * 一貫した間隔でUIの統一感を確保
 *
 * 8pxスケール: 4/8/12/16/24/32/40/48px
 * - セクション間は最低24px以上を確保
 */
export const SPACING = {
  /** 縦方向の間隔（space-y-*） - 8pxベース */
  stack: {
    /** 8px - アイコンとテキストの間隔など */
    tight: 'space-y-2',
    /** 16px - フォーム要素間のデフォルト */
    default: 'space-y-4',
    /** 24px - セクション内の要素間 */
    relaxed: 'space-y-6',
    /** 32px - セクション間の大きな間隔 */
    loose: 'space-y-8',
    /** 48px - 主要セクション間 */
    section: 'space-y-12',
  },
  /** 横方向の間隔（gap-*） - 8pxベース */
  inline: {
    /** 8px - 密接した要素間 */
    tight: 'gap-2',
    /** 16px - ボタンやアイコン間のデフォルト */
    default: 'gap-4',
    /** 24px - ゆったりした配置 */
    relaxed: 'gap-6',
    /** 32px - 大きな要素間 */
    loose: 'gap-8',
  },
  /** パディング - 8pxベース */
  padding: {
    /** 16px - 小さいカード・アイテム */
    sm: 'p-4',
    /** 24px - 中サイズのコンテナ */
    md: 'p-6',
    /** 32px - カード内のパディング */
    card: 'p-8',
    /** 48px - セクション・モーダルのパディング */
    section: 'p-12',
  },
} as const;

export type SpacingStackKey = keyof typeof SPACING.stack;
export type SpacingInlineKey = keyof typeof SPACING.inline;
export type SpacingPaddingKey = keyof typeof SPACING.padding;

// =============================================================================
// タイポグラフィ
// =============================================================================

/**
 * タイポグラフィ階層システム
 *
 * Primary/Secondary/Tertiary の視覚的差別化:
 * - PRIMARY: display (30-24px, bold) - ページ/セクションタイトル
 * - SECONDARY: heading (20-16px, semibold/medium) - サブセクション
 * - TERTIARY: body/caption (14-11px) - 本文と補助テキスト
 *
 * サイズ → ウェイト → カラー の順で強調
 */
export const TYPOGRAPHY = {
  // =========================================================================
  // PRIMARY階層 - Display (ページ/セクションタイトル)
  // =========================================================================
  /** ディスプレイスタイル - 最も目立つ見出し */
  display: {
    /** ページタイトル（30px, bold, tight line-height） */
    page: 'text-3xl font-bold leading-tight',
    /** セクションタイトル（24px, bold, snug line-height） */
    section: 'text-2xl font-bold leading-snug',
  },

  // =========================================================================
  // SECONDARY階層 - Heading (サブセクション、カード)
  // =========================================================================
  /** 見出しスタイル */
  heading: {
    /** Primary見出し（20px, semibold） - カードタイトル、サブセクション */
    primary: 'text-xl font-semibold leading-snug',
    /** Secondary見出し（18px, semibold） - 設定セクション、パネルタイトル */
    secondary: 'text-lg font-semibold',
    /** Tertiary見出し（16px, medium） - フォームヘッダー、小見出し */
    tertiary: 'text-base font-medium',
    // 後方互換エイリアス
    /** @deprecated Use display.page instead */
    page: 'text-2xl font-bold',
    /** @deprecated Use heading.secondary instead */
    section: 'text-lg font-semibold',
    /** @deprecated Use heading.tertiary instead */
    subsection: 'text-base font-medium',
    /** @deprecated Use body.emphasis instead */
    label: 'text-sm font-medium',
  },

  // =========================================================================
  // TERTIARY階層 - Body (本文)
  // =========================================================================
  /** 本文スタイル */
  body: {
    /** Primary本文（14px, normal） - 主要コンテンツ */
    primary: 'text-sm leading-normal',
    /** デフォルト本文（14px） - 後方互換 */
    default: 'text-sm',
    /** 強調本文（14px, medium） - 重要な値、インタラクティブラベル */
    emphasis: 'text-sm font-medium',
    /** Secondary本文（14px, relaxed） - 説明、ヒント */
    secondary: 'text-sm leading-relaxed',
    /** 小さい本文（12px） - 密度の高いリスト、テーブル */
    small: 'text-xs',
  },

  // =========================================================================
  // UTILITY - Caption, Overline
  // =========================================================================
  /** キャプション・補助テキスト */
  caption: {
    /** 通常キャプション（12px, muted） - タイムスタンプ、カウント */
    default: 'text-xs text-muted-foreground',
    /** Muted キャプション（12px, more muted） - 二次メタ情報 */
    muted: 'text-xs text-muted-foreground/60',
    /** @deprecated Use caption.muted instead */
    meta: 'text-xs text-muted-foreground/60',
  },

  /** オーバーライン - カテゴリラベル、セクションマーカー（11px, uppercase） */
  overline: 'text-[11px] font-medium uppercase tracking-wide',
} as const;

export type TypographyDisplayKey = keyof typeof TYPOGRAPHY.display;
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
  /** 浮き上がった背景（モーダル、ドロップダウン） */
  elevated: 'bg-surface-elevated',
  /** 沈んだ背景（入力フィールド、ネスト要素） */
  sunken: 'bg-surface-sunken',
} as const;

export type SurfaceColorKey = keyof typeof SURFACE_COLOR;

// =============================================================================
// ステータスカラー
// =============================================================================

/**
 * ステータス表示用カラーセット
 * CSS変数ベースで統一的に提供
 *
 * 移行マッピング:
 * - bg-green-* / text-green-* → STATUS_COLOR.success
 * - bg-yellow-* / text-yellow-* / text-amber-* → STATUS_COLOR.warning
 * - bg-red-* / text-red-* → STATUS_COLOR.error
 * - bg-blue-* / text-blue-* → STATUS_COLOR.info
 */
export const STATUS_COLOR = {
  success: {
    bg: 'bg-success/10',
    text: 'text-success',
    border: 'border-success/30',
  },
  warning: {
    bg: 'bg-warning/10',
    text: 'text-warning',
    border: 'border-warning/30',
  },
  error: {
    bg: 'bg-destructive/10',
    text: 'text-destructive',
    border: 'border-destructive/30',
  },
  info: {
    bg: 'bg-info/10',
    text: 'text-info',
    border: 'border-info/30',
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

// =============================================================================
// ステータスバッジ
// =============================================================================

/**
 * ステータスバッジ用スタイル定数
 * インポート履歴やファイル選択表示など、ステータス表示用のバッジスタイル
 * CSS変数ベースで統一
 */
export const STATUS_BADGE = {
  /** 成功・完了状態 */
  success: 'bg-success/10 text-success',
  /** 警告状態 */
  warning: 'bg-warning/10 text-warning',
  /** エラー状態 */
  error: 'bg-destructive/10 text-destructive',
  /** 情報状態 */
  info: 'bg-info/10 text-info',
  /** 控えめ・非アクティブ状態 */
  muted: 'bg-muted text-muted-foreground',
  /** プライマリ・選択状態 */
  primary: 'bg-primary/10 text-primary',
} as const;

export type StatusBadgeKey = keyof typeof STATUS_BADGE;
