import { cva, type VariantProps } from 'class-variance-authority';
import { AlertTriangle, Info, Lightbulb } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo } from 'react';

import { cn } from '../../../../components/lib/utils';
import { STATUS_COLOR, TEXT_COLOR, TYPOGRAPHY } from '../../../constants/ui';

/**
 * InfoBoxのバリアント定義
 *
 * 大きな背景カードをやめ、左アクセントバーのみでバリアントを区別する。
 * 設定画面全体の「余白で語る」方針に合わせて、情報の重要度はアクセント色だけで表現する。
 */
const infoBoxVariants = cva('border-l-2 pl-4 py-1', {
  variants: {
    variant: {
      /** 一般的な情報・ヒント */
      info: 'border-primary/40',
      /** 注意事項 */
      warning: STATUS_COLOR.warning.border,
      /** 成功・完了 */
      success: STATUS_COLOR.success.border,
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
 * バリアントに対応するアイコン色を取得
 * アイコンのみバリアントカラー、本文は通常カラーに保つ。
 */
const getIconColorClass = (variant: InfoBoxVariantProps['variant']) => {
  switch (variant) {
    case 'warning':
      return STATUS_COLOR.warning.text;
    case 'success':
      return STATUS_COLOR.success.text;
    case 'info':
    case undefined:
    case null:
      return 'text-primary/80';
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
    const iconColor = getIconColorClass(variant);

    return (
      <div className={cn(infoBoxVariants({ variant }), className)}>
        {title && (
          <h4
            className={cn(
              'flex items-center mb-2',
              TYPOGRAPHY.body.emphasis,
              TEXT_COLOR.primary,
            )}
          >
            {!hideIcon && (
              <Icon
                className={cn('h-4 w-4 mr-2 flex-shrink-0', iconColor)}
                aria-hidden="true"
              />
            )}
            {title}
          </h4>
        )}
        <div
          className={cn(
            TYPOGRAPHY.body.small,
            TEXT_COLOR.secondary,
            'leading-relaxed',
          )}
        >
          {children}
        </div>
      </div>
    );
  },
);

SettingsInfoBox.displayName = 'SettingsInfoBox';

export { infoBoxVariants, SettingsInfoBox };
export type { SettingsInfoBoxProps };
