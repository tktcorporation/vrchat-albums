import type { ReactNode } from 'react';
import { memo } from 'react';

import { cn } from '../../../../components/lib/utils';
import { TEXT_COLOR, TYPOGRAPHY } from '../../../constants/ui';

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
          'flex items-start justify-between gap-6',
          disabled && 'opacity-50',
          className,
        )}
      >
        {/* ラベルと説明 */}
        <div className="flex-1 min-w-0 space-y-1">
          <div
            className={cn(TYPOGRAPHY.body.emphasis, TEXT_COLOR.primary)}
            id={`settings-item-${label.replaceAll(/\s+/g, '-').toLowerCase()}`}
          >
            {label}
          </div>
          {description && (
            <div
              className={cn(
                TYPOGRAPHY.body.small,
                TEXT_COLOR.secondary,
                'leading-relaxed',
              )}
            >
              {description}
            </div>
          )}
        </div>

        {/* 操作要素 */}
        <div className="flex-shrink-0 pt-0.5">{children}</div>
      </div>
    );
  },
);

SettingsItem.displayName = 'SettingsItem';

export { SettingsItem };
export type { SettingsItemProps };
