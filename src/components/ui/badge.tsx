import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../lib/utils';

/**
 * Badgeコンポーネントのバリアント定義
 * ステータス表示、タグ、ラベルなどに使用
 */
const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        /** デフォルト - プライマリカラーベース */
        default: 'bg-primary/10 text-primary border border-primary/20',
        /** セカンダリ - 控えめな表示 */
        secondary:
          'bg-secondary text-secondary-foreground border border-secondary/50',
        /** 成功 - 完了、有効などのポジティブな状態 */
        success:
          'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-200 border border-green-200 dark:border-green-800',
        /** 警告 - 注意が必要な状態 */
        warning:
          'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200 border border-yellow-200 dark:border-yellow-800',
        /** エラー - 問題がある状態 */
        error:
          'bg-destructive/10 text-destructive border border-destructive/20',
        /** 情報 - 補足情報 */
        info: 'bg-primary/10 text-primary border border-primary/20',
        /** Glass - Glass morphism効果 */
        glass:
          'backdrop-blur-sm bg-white/30 dark:bg-black/30 border border-white/20 dark:border-gray-700/30',
        /** アウトライン - ボーダーのみ */
        outline: 'border border-border bg-transparent text-foreground',
      },
      size: {
        /** 小サイズ - コンパクトな表示 */
        sm: 'px-2 py-0.5 text-xs',
        /** デフォルトサイズ */
        default: 'px-2.5 py-0.5 text-xs',
        /** 大サイズ - 目立たせたい場合 */
        lg: 'px-3 py-1 text-sm',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

/**
 * ステータス表示、タグ、ラベルなどに使用するバッジコンポーネント
 *
 * @example
 * // 基本的な使用方法
 * <Badge>New</Badge>
 *
 * // バリアント指定
 * <Badge variant="success">Complete</Badge>
 * <Badge variant="warning">Pending</Badge>
 * <Badge variant="error">Failed</Badge>
 *
 * // サイズ指定
 * <Badge size="lg">Large Badge</Badge>
 */
const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant, size, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Badge.displayName = 'Badge';

export { Badge, badgeVariants };
