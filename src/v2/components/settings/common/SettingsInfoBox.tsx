import { cva, type VariantProps } from 'class-variance-authority';
import { AlertTriangle, Info, Lightbulb } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo } from 'react';

import { cn } from '../../../../components/lib/utils';
import { SPACING, STATUS_COLOR, TYPOGRAPHY } from '../../../constants/ui';

/**
 * InfoBoxのバリアント定義
 */
const infoBoxVariants = cva('rounded-xl', {
  variants: {
    variant: {
      /** 一般的な情報・ヒント — 極めて薄い背景で主張しすぎない */
      info: 'bg-primary/5',
      /** 注意事項 */
      warning: 'bg-warning/5',
      /** 成功・完了 */
      success: 'bg-success/5',
    },
  },
  defaultVariants: {
    variant: 'info',
  },
});

type InfoBoxVariantProps = VariantProps<typeof infoBoxVariants>;

interface SettingsInfoBoxProps extends InfoBoxVariantProps {
  /** ボックスタイトル（オプション） */
  title?: string;
  /** コンテンツ */
  children: ReactNode;
  /** アイコンを非表示にする */
  hideIcon?: boolean;
  /** 追加のクラス名 */
  className?: string;
}

/**
 * バリアントに対応するアイコンを取得
 */
const getVariantIcon = (variant: InfoBoxVariantProps['variant']) => {
  switch (variant) {
    case 'warning':
      return AlertTriangle;
    case 'success':
      return Lightbulb;
    case 'info':
    case undefined:
    case null:
      return Info;
  }
};

/**
 * バリアントに対応するテキストカラーを取得
 */
const getTextColorClass = (variant: InfoBoxVariantProps['variant']) => {
  switch (variant) {
    case 'warning':
      return STATUS_COLOR.warning.text;
    case 'success':
      return STATUS_COLOR.success.text;
    case 'info':
    case undefined:
    case null:
      return 'text-primary';
  }
};

/**
 * 設定画面用の情報ボックスコンポーネント
 *
 * ヒント、注意事項、成功メッセージなどを表示する。
 *
 * @example
 * <SettingsInfoBox title="インポート機能について">
 *   <ul>
 *     <li>• logStoreファイルを統合します</li>
 *     <li>• 重複データは除外されます</li>
 *   </ul>
 * </SettingsInfoBox>
 *
 * @example
 * <SettingsInfoBox variant="warning" title="注意">
 *   この操作は元に戻せません
 * </SettingsInfoBox>
 */
const SettingsInfoBox = memo<SettingsInfoBoxProps>(
  ({ title, variant = 'info', children, hideIcon, className }) => {
    const Icon = getVariantIcon(variant);
    const textColor = getTextColorClass(variant);

    return (
      <div
        className={cn(
          infoBoxVariants({ variant }),
          SPACING.padding.sm,
          className,
        )}
      >
        {title && (
          <h4
            className={cn(
              'flex items-center',
              TYPOGRAPHY.body.emphasis,
              textColor,
              'mb-2',
            )}
          >
            {!hideIcon && <Icon className="h-4 w-4 mr-2" aria-hidden="true" />}
            {title}
          </h4>
        )}
        <div className={cn(TYPOGRAPHY.body.small, `${textColor}/80`)}>
          {children}
        </div>
      </div>
    );
  },
);

SettingsInfoBox.displayName = 'SettingsInfoBox';

export { infoBoxVariants, SettingsInfoBox };
export type { SettingsInfoBoxProps };
