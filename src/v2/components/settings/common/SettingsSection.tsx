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
 * 設定セクションコンテナ — Arc/Claude風の圧倒的余白
 *
 * セクション間は56px以上。タイトルは極めて控えめな overline。
 * コンテンツは広大な余白の中に浮かぶ。
 */
const SettingsSection = memo<SettingsSectionProps>(
  ({ icon: Icon, title, description, children, className }) => {
    return (
      <section className={cn('mb-16', className)}>
        {/* セクションタイトル — 極限まで控えめ */}
        <div className="mb-10">
          <h3 className="flex items-center text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
            {Icon && <Icon className="h-3 w-3 mr-2" aria-hidden="true" />}
            {title}
          </h3>
          {description && (
            <p className="mt-3 text-[13px] text-muted-foreground leading-relaxed max-w-md">
              {description}
            </p>
          )}
        </div>

        {/* コンテンツ — 要素間を大きく空ける */}
        <div className="space-y-8">{children}</div>
      </section>
    );
  },
);

SettingsSection.displayName = 'SettingsSection';

export { SettingsSection };
export type { SettingsSectionProps };
