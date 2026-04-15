import type { ReactNode } from 'react';
import { memo } from 'react';

import { cn } from '../../../../components/lib/utils';
import { TEXT_COLOR } from '../../../constants/ui';

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
 * ラベル + 説明 + 操作要素のレイアウトを提供。
 * トグルスイッチ、セレクトボックスなどの設定項目に使用。
 *
 * @example
 * <SettingsItem
 *   label="自動起動"
 *   description="システム起動時にアプリを自動的に起動します"
 * >
 *   <Switch checked={autoStart} onCheckedChange={setAutoStart} />
 * </SettingsItem>
 *
 * @example
 * <SettingsItem label="言語">
 *   <Select value={language} onValueChange={setLanguage}>
 *     <SelectItem value="ja">日本語</SelectItem>
 *     <SelectItem value="en">English</SelectItem>
 *   </Select>
 * </SettingsItem>
 */
const SettingsItem = memo<SettingsItemProps>(
  ({ label, description, children, disabled, className }) => {
    return (
      <div
        className={cn(
          'flex items-center justify-between py-2',
          disabled && 'opacity-40',
          className,
        )}
      >
        {/* ラベルと説明 */}
        <div className="flex-1 min-w-0 mr-6">
          <div
            className={cn('text-sm font-medium', TEXT_COLOR.primary)}
            id={`settings-item-${label.replaceAll(/\s+/g, '-').toLowerCase()}`}
          >
            {label}
          </div>
          {description && (
            <div className={cn('text-xs mt-0.5', TEXT_COLOR.secondary)}>
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
