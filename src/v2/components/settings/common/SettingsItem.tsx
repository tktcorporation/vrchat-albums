import type { ReactNode } from 'react';
import { memo } from 'react';

import { cn } from '../../../../components/lib/utils';

interface SettingsItemProps {
  /** 設定項目のラベル */
  label: string;
  /** 設定項目の説明（オプション） */
  description?: string;
  /** 操作要素（Switch, Select など） */
  children: ReactNode;
  /** 無効状態 */
  disabled?: boolean;
  /** 追加のクラス名 */
  className?: string;
}

/**
 * 設定項目コンポーネント
 *
 * Arc風：ラベルと操作要素を広い余白で配置。
 * 各項目間の「呼吸」を最大化する。
 */
const SettingsItem = memo<SettingsItemProps>(
  ({ label, description, children, disabled, className }) => {
    return (
      <div
        className={cn(
          'flex items-center justify-between py-3',
          disabled && 'opacity-35',
          className,
        )}
      >
        {/* ラベルと説明 — 広いマージンで操作要素と分離 */}
        <div className="flex-1 min-w-0 mr-8">
          <div
            className="text-[13px] font-medium text-foreground"
            id={`settings-item-${label.replaceAll(/\s+/g, '-').toLowerCase()}`}
          >
            {label}
          </div>
          {description && (
            <div className="text-[12px] mt-1 text-muted-foreground/60 leading-relaxed">
              {description}
            </div>
          )}
        </div>

        {/* 操作要素 */}
        <div className="flex-shrink-0">{children}</div>
      </div>
    );
  },
);

SettingsItem.displayName = 'SettingsItem';

export { SettingsItem };
export type { SettingsItemProps };
