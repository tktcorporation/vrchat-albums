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
 * 設定項目 — Arc/Claude 風：各アイテムが広い余白の中に浮く
 *
 * ラベルは普通の weight、description はかなり薄い。
 * 操作要素との間に十分なマージン。
 */
const SettingsItem = memo<SettingsItemProps>(
  ({ label, description, children, disabled, className }) => {
    return (
      <div
        className={cn(
          'flex items-center justify-between py-4',
          disabled && 'opacity-30',
          className,
        )}
      >
        <div className="flex-1 min-w-0 mr-12">
          <div
            className="text-[13px] text-foreground"
            id={`settings-item-${label.replaceAll(/\s+/g, '-').toLowerCase()}`}
          >
            {label}
          </div>
          {description && (
            <div className="text-[12px] mt-1.5 text-muted-foreground leading-relaxed">
              {description}
            </div>
          )}
        </div>

        <div className="flex-shrink-0">{children}</div>
      </div>
    );
  },
);

SettingsItem.displayName = 'SettingsItem';

export { SettingsItem };
export type { SettingsItemProps };
