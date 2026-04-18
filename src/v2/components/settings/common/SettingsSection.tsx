import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo } from 'react';

import { cn } from '../../../../components/lib/utils';
import { SPACING, TEXT_COLOR, TYPOGRAPHY } from '../../../constants/ui';

interface SettingsSectionProps {
  /**
   * セクションアイコン（非推奨）
   *
   * 余白で区切るデザインに統一するため、セクションヘッダーではアイコンを表示しない。
   * 互換性のため型として残しているが、渡されても描画しない。
   * @deprecated タブナビゲーションのアイコンと冗長。渡しても無視される。
   */
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
