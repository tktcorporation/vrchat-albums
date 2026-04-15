import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo } from 'react';

import { cn } from '../../../../components/lib/utils';

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
 * Arc風の広大な余白を持つセクションレイアウト。
 * タイトルは控えめな overline スタイル、コンテンツは大きな余白で呼吸させる。
 */
const SettingsSection = memo<SettingsSectionProps>(
  ({ icon: Icon, title, description, children, className }) => {
    return (
      <section className={cn('mb-14', className)}>
        {/* セクションヘッダー — 控えめだが明確 */}
        <div className="mb-8">
          <h3 className="flex items-center text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/40">
            {Icon && (
              <Icon className="h-3 w-3 mr-2 opacity-40" aria-hidden="true" />
            )}
            {title}
          </h3>
          {description && (
            <p className="mt-2 text-[13px] text-muted-foreground/60 leading-relaxed">
              {description}
            </p>
          )}
        </div>

        {/* コンテンツ — 各アイテム間を大きく空ける */}
        <div className="space-y-6">{children}</div>
      </section>
    );
  },
);

SettingsSection.displayName = 'SettingsSection';

export { SettingsSection };
export type { SettingsSectionProps };
