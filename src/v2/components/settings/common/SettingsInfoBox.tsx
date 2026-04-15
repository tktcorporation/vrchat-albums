import { cva, type VariantProps } from 'class-variance-authority';
import { AlertTriangle, Info, Lightbulb } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo } from 'react';

import { cn } from '../../../../components/lib/utils';
import { STATUS_COLOR } from '../../../constants/ui';

/**
 * InfoBoxのバリアント定義 — 背景はほぼ透明、主張しない
 */
const infoBoxVariants = cva('rounded-2xl', {
  variants: {
    variant: {
      info: 'bg-primary/[0.03]',
      warning: 'bg-warning/[0.03]',
      success: 'bg-success/[0.03]',
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
 * 情報ボックス — 極めて控えめな背景、広い余白
 */
const SettingsInfoBox = memo<SettingsInfoBoxProps>(
  ({ title, variant = 'info', children, hideIcon, className }) => {
    const Icon = getVariantIcon(variant);
    const textColor = getTextColorClass(variant);

    return (
      <div className={cn(infoBoxVariants({ variant }), 'px-6 py-5', className)}>
        {title && (
          <h4
            className={cn(
              'flex items-center text-[13px] font-medium',
              textColor,
              'mb-3',
            )}
          >
            {!hideIcon && (
              <Icon
                className="h-3.5 w-3.5 mr-2.5 opacity-60"
                aria-hidden="true"
              />
            )}
            {title}
          </h4>
        )}
        <div className={cn('text-[12px] leading-relaxed', `${textColor}/60`)}>
          {children}
        </div>
      </div>
    );
  },
);

SettingsInfoBox.displayName = 'SettingsInfoBox';

export { infoBoxVariants, SettingsInfoBox };
export type { SettingsInfoBoxProps };
