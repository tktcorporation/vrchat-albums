import type { ReactNode } from 'react';
import { memo } from 'react';

import { cn } from '../../../../components/lib/utils';

interface SettingsFieldProps {
  /** フィールドラベル */
  label: string;
  /** ラベルの htmlFor（input の id と対応） */
  htmlFor?: string;
  /** 補足説明テキスト */
  description?: string;
  /** 入力要素 */
  children: ReactNode;
  /** エラーメッセージ */
  error?: string | null;
  /** 追加クラス名 */
  className?: string;
}

/**
 * 設定フォームフィールド — shadcn FormItem 相当
 *
 * label・入力・description・error を一貫した余白で配置する。
 * gap-3 (12px) でラベルと入力の間を確保。
 * フィールド同士の間隔は親側で制御（gap-10 等）。
 */
const SettingsField = memo<SettingsFieldProps>(
  ({ label, htmlFor, description, children, error, className }) => {
    return (
      <div className={cn('flex flex-col gap-3', className)}>
        <label htmlFor={htmlFor} className="text-sm text-muted-foreground">
          {label}
        </label>

        {children}

        {description && (
          <p className="text-sm text-muted-foreground/70 leading-relaxed">
            {description}
          </p>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    );
  },
);

SettingsField.displayName = 'SettingsField';

export { SettingsField };
export type { SettingsFieldProps };
