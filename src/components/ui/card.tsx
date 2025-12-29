import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../lib/utils';

/**
 * Cardコンポーネントのバリアント定義
 * コンテンツをグループ化するコンテナとして使用
 */
const cardVariants = cva('rounded-lg transition-all duration-200', {
  variants: {
    variant: {
      /** デフォルト - 標準的なカード */
      default: 'bg-card border border-border shadow-sm',
      /** Glass - Glass morphism効果 */
      glass:
        'bg-glass backdrop-blur-md border border-glass-border shadow-glass',
      /** 浮き上がり - ホバー時に影が強調 */
      elevated: 'bg-card border border-border shadow-md hover:shadow-lg',
      /** ゴースト - 背景なし */
      ghost: 'bg-transparent',
      /** アウトライン - ボーダーのみ */
      outline: 'bg-transparent border border-border',
    },
    padding: {
      /** パディングなし */
      none: 'p-0',
      /** 小（8px） */
      sm: 'p-2',
      /** 中（12px） */
      md: 'p-3',
      /** デフォルト（16px） */
      default: 'p-4',
      /** 大（24px） */
      lg: 'p-6',
    },
  },
  defaultVariants: {
    variant: 'default',
    padding: 'default',
  },
});

interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

/**
 * コンテンツをグループ化するカードコンポーネント
 *
 * @example
 * // 基本的な使用方法
 * <Card>
 *   <CardHeader>
 *     <CardTitle>Title</CardTitle>
 *   </CardHeader>
 *   <CardContent>Content here</CardContent>
 * </Card>
 *
 * // バリアント指定
 * <Card variant="glass">Glass effect card</Card>
 * <Card variant="elevated">Elevated card</Card>
 *
 * // パディング指定
 * <Card padding="lg">Large padding card</Card>
 */
const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, padding, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(cardVariants({ variant, padding }), className)}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

/**
 * カードのヘッダー部分
 */
const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex flex-col space-y-1.5', className)}
    {...props}
  />
));
CardHeader.displayName = 'CardHeader';

/**
 * カードのタイトル
 */
const CardTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn(
      'text-lg font-semibold leading-none tracking-tight',
      className,
    )}
    {...props}
  />
));
CardTitle.displayName = 'CardTitle';

/**
 * カードの説明文
 */
const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));
CardDescription.displayName = 'CardDescription';

/**
 * カードのコンテンツ部分
 */
const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('', className)} {...props} />
));
CardContent.displayName = 'CardContent';

/**
 * カードのフッター部分
 */
const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex items-center pt-4', className)}
    {...props}
  />
));
CardFooter.displayName = 'CardFooter';

export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  cardVariants,
};
