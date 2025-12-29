import { AlertCircle, FolderOpen, Save } from 'lucide-react';
import type { ChangeEvent } from 'react';
import { memo } from 'react';
import { cn } from '../../../../components/lib/utils';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { SPACING, TEXT_COLOR, TYPOGRAPHY } from '../../../constants/ui';

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
 * Input + 参照/保存ボタン + エラー表示を提供。
 * 写真ディレクトリやログファイルのパス設定に使用。
 *
 * @example
 * <SettingsPathInput
 *   label="写真ディレクトリ"
 *   value={photoPath}
 *   onChange={setPhotoPath}
 *   onBrowse={handleBrowse}
 *   onSave={handleSave}
 *   isManuallyChanged={hasChanges}
 *   error={validationError}
 *   placeholder="/path/to/photos"
 * />
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

    const inputId = `path-input-${label.replace(/\s+/g, '-').toLowerCase()}`;

    return (
      <div className={cn(SPACING.stack.default, className)}>
        {/* ラベル */}
        <label
          htmlFor={inputId}
          className={cn(TYPOGRAPHY.body.emphasis, TEXT_COLOR.secondary)}
        >
          {label}
        </label>

        {/* 入力欄とボタン */}
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
              variant="secondary"
              size="sm"
              onClick={onBrowse}
              disabled={disabled || readOnly}
            >
              <FolderOpen className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* エラーメッセージ */}
        {error && (
          <div className="flex items-center text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mr-1 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
    );
  },
);

SettingsPathInput.displayName = 'SettingsPathInput';

export { SettingsPathInput };
export type { SettingsPathInputProps };
