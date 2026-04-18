import type { ReactNode } from 'react';
import { memo } from 'react';

import { cn } from '../../../../components/lib/utils';
import { TEXT_COLOR, TYPOGRAPHY } from '../../../constants/ui';

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
 * 設定フォームフィールド — label / 入力 / description / error を一貫した余白で配置
 *
 * gap-3 (12px) でラベルと入力の距離を近づけ、関係性を視覚的に結びつける。
 * フィールド同士の間隔は呼び出し側で制御（space-y-10 等）。
 *
 * ラベルは `body.default` + `TEXT_COLOR.secondary` で控えめに。`SettingsItem`
 * (トグル/セレクト) はラベルを `body.emphasis` + `TEXT_COLOR.primary` で主役化
 * するのに対し、テキスト入力フィールドでは入力値自体が主役なので、ラベルは
 * weight とカラーの両方で背景化する。
 *
 * @example
 * <SettingsField label="ログファイル" htmlFor="log-input" error={logError}>
 *   <Input id="log-input" />
 * </SettingsField>
 */
const SettingsField = memo<SettingsFieldProps>(
  ({ label, htmlFor, description, children, error, className }) => {
    const labelClassName = cn(TYPOGRAPHY.body.default, TEXT_COLOR.secondary);
    // htmlFor が無い場合は <label> を出すと orphan label になりアクセシビリティ
    // 違反 (axe-core, スクリーンリーダー) となるため、<span> にフォールバックする
    return (
      <div className={cn('flex flex-col gap-3', className)}>
        {htmlFor ? (
          <label htmlFor={htmlFor} className={labelClassName}>
            {label}
          </label>
        ) : (
          <span className={labelClassName}>{label}</span>
        )}

        {children}

        {description && (
          <p
            className={cn(
              TYPOGRAPHY.body.small,
              TEXT_COLOR.secondary,
              'leading-relaxed',
            )}
          >
            {description}
          </p>
        )}

        {error && (
          <p className={cn(TYPOGRAPHY.body.default, 'text-destructive')}>
            {error}
          </p>
        )}
      </div>
    );
  },
);

SettingsField.displayName = 'SettingsField';

export { SettingsField };
export type { SettingsFieldProps };
