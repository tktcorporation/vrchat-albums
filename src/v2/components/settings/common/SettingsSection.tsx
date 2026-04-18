import type { ReactNode } from 'react';
import { memo } from 'react';

import { cn } from '../../../../components/lib/utils';
import { SPACING, TEXT_COLOR, TYPOGRAPHY } from '../../../constants/ui';

interface SettingsSectionProps {
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
 * タイポグラフィと余白だけで階層を表現する設計。
 * セクションヘッダーにはアイコンを置かず、タブナビゲーションのアイコンとの冗長を避ける。
 *
 * @example
 * <SettingsSection title="テーマ設定">
 *   <ThemeOptions />
 * </SettingsSection>
 *
 * @example
 * <SettingsSection
 *   title="システム設定"
 *   description="アプリの動作に関する設定"
 * >
 *   <SettingsItem label="自動起動">
 *     <Switch />
 *   </SettingsItem>
 * </SettingsSection>
 */
const SettingsSection = memo<SettingsSectionProps>(
  ({ title, description, children, className }) => {
    return (
      <section className={cn(SPACING.stack.loose, className)}>
        {/* ヘッダー: アイコンに頼らず、タイポグラフィと余白だけで階層を表現する */}
        <div className={SPACING.stack.tight}>
          <h3 className={cn(TYPOGRAPHY.heading.primary, TEXT_COLOR.primary)}>
            {title}
          </h3>
          {description && (
            <p className={cn(TYPOGRAPHY.body.secondary, TEXT_COLOR.secondary)}>
              {description}
            </p>
          )}
        </div>

        {/* コンテンツ */}
        <div className={SPACING.stack.relaxed}>{children}</div>
      </section>
    );
  },
);

SettingsSection.displayName = 'SettingsSection';

export { SettingsSection };
export type { SettingsSectionProps };
