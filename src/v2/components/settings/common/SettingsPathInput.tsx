import { FolderOpen, Save } from 'lucide-react';
import type { ChangeEvent } from 'react';
import { memo } from 'react';

import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { SettingsField } from './SettingsField';

interface SettingsPathInputProps {
  /** ラベル */
  label: string;
  /** 入力値 */
  value: string;
  /** 入力値変更ハンドラ */
  onChange: (value: string) => void;
  /** 参照ボタンクリック時のハンドラ */
  onBrowse: () => void;
  /** 保存ボタンクリック時のハンドラ */
  onSave?: () => void;
  /** 手動変更されたかどうか（保存ボタン表示の制御） */
  isManuallyChanged?: boolean;
  /** エラーメッセージ */
  error?: string | null;
  /** プレースホルダー */
  placeholder?: string;
  /** 参照ボタンのaria-label */
  browseLabel?: string;
  /** 保存ボタンのaria-label */
  saveLabel?: string;
  /** 読み取り専用 */
  readOnly?: boolean;
  /** 無効状態 */
  disabled?: boolean;
  /** 追加のクラス名 */
  className?: string;
}

/**
 * 設定画面用のパス入力コンポーネント
 *
 * SettingsField でラベル・入力・エラーの余白を統一。
 * 写真ディレクトリやログファイルのパス設定に使用。
 */
const SettingsPathInput = memo<SettingsPathInputProps>(
  ({
    label,
    value,
    onChange,
    onBrowse,
    onSave,
    isManuallyChanged = false,
    error,
    placeholder,
    browseLabel,
    saveLabel,
    readOnly,
    disabled,
    className,
  }) => {
    const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
      onChange(event.target.value);
    };

    const inputId = `path-input-${label.replaceAll(/\s+/g, '-').toLowerCase()}`;

    return (
      <SettingsField
        label={label}
        htmlFor={inputId}
        error={error}
        className={className}
      >
        <div className="flex gap-2">
          <Input
            id={inputId}
            type="text"
            aria-label={`input-${label}`}
            value={value}
            onChange={handleInputChange}
            placeholder={placeholder}
            readOnly={readOnly}
            disabled={disabled}
            className="flex-1"
          />
          {isManuallyChanged && onSave ? (
            <Button
              type="button"
              aria-label={saveLabel ?? `保存-${label}`}
              variant="default"
              size="sm"
              onClick={onSave}
              disabled={disabled}
            >
              <Save className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              type="button"
              aria-label={browseLabel ?? `参照-${label}`}
              variant="ghost"
              size="sm"
              onClick={onBrowse}
              disabled={disabled ?? readOnly}
              className="text-muted-foreground/60 hover:text-foreground"
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
          )}
        </div>
      </SettingsField>
    );
  },
);

SettingsPathInput.displayName = 'SettingsPathInput';

export { SettingsPathInput };
export type { SettingsPathInputProps };
