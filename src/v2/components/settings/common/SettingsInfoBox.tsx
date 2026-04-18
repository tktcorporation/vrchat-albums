import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';
import { memo } from 'react';

import { cn } from '../../../../components/lib/utils';
import { STATUS_COLOR, TEXT_COLOR, TYPOGRAPHY } from '../../../constants/ui';

/**
 * InfoBox のバリアント定義。
 *
 * 「余白で語る」方針に合わせ、装飾的アイコンは置かず左アクセントバーだけで
 * 情報の重要度を示す。バリアントは左 border の色のみに反映される。
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
  /** 追加のクラス名 */
  className?: string;
}

/**
 * 設定画面用の情報ボックス。
 *
 * 左アクセントバーとタイポグラフィのみで情報階層を表現する。
 * タイトルは emphasis、本文は secondary muted。
 *
 * @example
 * <SettingsInfoBox title="インポート機能について">
 *   <ul>...</ul>
 * </SettingsInfoBox>
 *
 * @example
 * <SettingsInfoBox variant="warning" title="注意">
 *   この操作は元に戻せません
 * </SettingsInfoBox>
 */
const SettingsInfoBox = memo<SettingsInfoBoxProps>(
  ({ title, variant = 'info', children, className }) => {
    return (
      <div className={cn(infoBoxVariants({ variant }), className)}>
        {title && (
          <h4
            className={cn('mb-2', TYPOGRAPHY.body.emphasis, TEXT_COLOR.primary)}
          >
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
