import { memo } from 'react';

import { cn } from '@/components/lib/utils';

import { OPTION_BUTTON, TYPOGRAPHY } from '../../constants/ui';
import { useTheme } from '../../hooks/useTheme';
import { useI18n } from '../../i18n/store';
import type { Theme } from '../../utils/theme';
import { SettingsSection } from './common';

/**
 * テーマをシステム・ダーク・ライトから選択する UI。
 * SettingsModal のテーマタブで利用される。
 *
 * 「余白で語る」方針: アイコンを置かず、ラベルと選択状態のトーン差だけで構成する。
 */
const ThemeSelector = memo(() => {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();

  const themeOptions: { value: Theme; label: string }[] = [
    { value: 'system', label: t('settings.theme.system') },
    { value: 'dark', label: t('settings.theme.dark') },
    { value: 'light', label: t('settings.theme.light') },
  ];

  return (
    <SettingsSection title={t('settings.theme.title')}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {themeOptions.map(({ value, label }) => (
          <button
            type="button"
            key={value}
            onClick={() => setTheme(value)}
            aria-pressed={theme === value}
            className={cn(
              'flex items-center justify-center px-3 py-4 rounded-md transition-colors',
              theme === value ? OPTION_BUTTON.selected : OPTION_BUTTON.default,
            )}
          >
            <span className={TYPOGRAPHY.body.emphasis}>{label}</span>
          </button>
        ))}
      </div>
    </SettingsSection>
  );
});

ThemeSelector.displayName = 'ThemeSelector';

export default ThemeSelector;
