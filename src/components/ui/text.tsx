import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../lib/utils';

/**
 * Textコンポーネントのバリアント定義
 * 一貫したタイポグラフィを提供
 */
const textVariants = cva('', {
  variants: {
    variant: {
      /** デフォルト本文（14px） */
      body: 'text-sm',
      /** 小さい本文（12px） */
      small: 'text-xs',
      /** キャプション（12px, muted） */
      caption: 'text-xs text-muted-foreground',
      /** メタ情報（12px, more muted） */
      meta: 'text-xs text-muted-foreground/60',
      /** ラベル（14px, medium） */
      label: 'text-sm font-medium',
      /** 強調（14px, medium） */
      emphasis: 'text-sm font-medium',
    },
    color: {
      /** デフォルト - 継承 */
      default: '',
      /** 主要テキスト */
      primary: 'text-foreground',
      /** 二次テキスト */
      secondary: 'text-muted-foreground',
      /** 控えめなテキスト */
      muted: 'text-muted-foreground/60',
      /** アクセントカラー */
      accent: 'text-primary',
      /** 成功 */
      success: 'text-green-800 dark:text-green-200',
      /** 警告 */
      warning: 'text-yellow-800 dark:text-yellow-200',
      /** エラー */
      error: 'text-destructive',
    },
  },
  defaultVariants: {
    variant: 'body',
    color: 'default',
  },
});

type TextVariantProps = VariantProps<typeof textVariants>;

interface TextProps
  extends Omit<React.ComponentPropsWithoutRef<'span'>, 'color'>,
    TextVariantProps {
  /** レンダリングする要素 */
  as?: 'span' | 'p';
}

/**
 * 一貫したタイポグラフィを提供するテキストコンポーネント
 *
 * @example
 * // 基本的な使用方法
 * <Text>Default body text</Text>
 *
 * // バリアント指定
 * <Text variant="caption">Caption text</Text>
 * <Text variant="label">Label text</Text>
 *
 * // カラー指定
 * <Text color="muted">Muted text</Text>
 * <Text color="accent">Accent text</Text>
 *
 * // 要素の変更
 * <Text as="p">Paragraph element</Text>
 */
function TextComponent(
  {
    className,
    variant,
    color,
    as: Component = 'span',
    ...props
  }: TextProps & { ref?: React.Ref<HTMLSpanElement | HTMLParagraphElement> },
  ref: React.Ref<HTMLSpanElement | HTMLParagraphElement>,
) {
  return (
    <Component
      // @ts-expect-error - 型の共変性の問題、実行時は問題なし
      ref={ref}
      className={cn(textVariants({ variant, color }), className)}
      {...props}
    />
  );
}

const Text = React.forwardRef(TextComponent);
Text.displayName = 'Text';

// =============================================================================
// 見出しコンポーネント
// =============================================================================

/**
 * Headingコンポーネントのバリアント定義
 */
const headingVariants = cva('', {
  variants: {
    level: {
      /** ページタイトル（24px, bold） */
      1: 'text-2xl font-bold',
      /** セクション見出し（18px, semibold） */
      2: 'text-lg font-semibold',
      /** サブセクション（16px, medium） */
      3: 'text-base font-medium',
      /** 小見出し（14px, medium） */
      4: 'text-sm font-medium',
    },
    color: {
      /** デフォルト */
      default: 'text-foreground',
      /** 控えめ */
      muted: 'text-muted-foreground',
      /** アクセント */
      accent: 'text-primary',
    },
  },
  defaultVariants: {
    level: 2,
    color: 'default',
  },
});

type HeadingVariantProps = VariantProps<typeof headingVariants>;

interface HeadingProps
  extends Omit<React.HTMLAttributes<HTMLHeadingElement>, 'color'>,
    HeadingVariantProps {}

/**
 * 見出しコンポーネント
 * levelに応じてh1-h4要素としてレンダリング
 *
 * @example
 * <Heading level={1}>Page Title</Heading>
 * <Heading level={2}>Section Title</Heading>
 * <Heading level={3}>Subsection Title</Heading>
 */
const Heading = React.forwardRef<HTMLHeadingElement, HeadingProps>(
  ({ className, level = 2, color, ...props }, ref) => {
    const Component = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4';
    return (
      <Component
        ref={ref}
        className={cn(headingVariants({ level, color }), className)}
        {...props}
      />
    );
  },
);
Heading.displayName = 'Heading';

export { Heading, headingVariants, Text, textVariants };
