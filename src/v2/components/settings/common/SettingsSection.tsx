import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo } from 'react';

import { cn } from '../../../../components/lib/utils';
import { SPACING, TEXT_COLOR } from '../../../constants/ui';

interface SettingsSectionProps {
  /** セクションアイコン */
  icon?: LucideIcon;
  /** セクションタイトル */
  title: string;
  /** セクションの補足説明 */
  description?: string;
  /** セクションコンテンツ */
  children: ReactNode;
  /** 追加のクラス名 */
  className?: string;
}

/**
 * 設定セクションコンテナ
 *
 * アイコン付きヘッダーと一貫したスペーシングを提供。
 * 設定画面内の各セクションを統一的にレイアウトする。
 *
 * @example
 * <SettingsSection icon={Palette} title="テーマ設定">
 *   <ThemeOptions />
 * </SettingsSection>
 *
 * @example
 * <SettingsSection
 *   icon={Settings}
 *   title="システム設定"
 *   description="アプリの動作に関する設定"
 * >
 *   <SettingsItem label="自動起動">
 *     <Switch />
 *   </SettingsItem>
 * </SettingsSection>
 */
const SettingsSection = memo<SettingsSectionProps>(
  ({ icon: Icon, title, description, children, className }) => {
    return (
      <section className={cn('mb-10', className)}>
        {/* ヘッダー — 余白を広めに取ってセクション感を出す */}
        <div className="mb-6">
          <h3
            className={cn(
              'flex items-center',
              'text-[13px] font-semibold uppercase tracking-wider',
              'text-muted-foreground/50',
            )}
          >
            {Icon && (
              <Icon
                className="h-3.5 w-3.5 mr-2 opacity-50"
                aria-hidden="true"
              />
            )}
            {title}
          </h3>
          {description && (
            <p className={cn('mt-1.5 text-sm', TEXT_COLOR.secondary)}>
              {description}
            </p>
          )}
        </div>

        {/* コンテンツ — ゆったりスペース */}
        <div className={SPACING.stack.loose}>{children}</div>
      </section>
    );
  },
);

SettingsSection.displayName = 'SettingsSection';

export { SettingsSection };
export type { SettingsSectionProps };
