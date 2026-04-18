import { Monitor, Moon, Sun } from 'lucide-react';
import { memo } from 'react';

import { cn } from '@/components/lib/utils';

import { OPTION_BUTTON, TEXT_COLOR, TYPOGRAPHY } from '../../constants/ui';
import { useTheme } from '../../hooks/useTheme';
import { useI18n } from '../../i18n/store';
import type { ThemeOption } from '../../utils/theme';
import { SettingsSection } from './common';

/**
 * テーマをシステム・ダーク・ライトから選択する UI。
 * SettingsModal のテーマタブで利用される。
 */
const ThemeSelector = memo(() => {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();

  const themeOptions: ThemeOption[] = [
    { value: 'system', label: t('settings.theme.system'), icon: Monitor },
    { value: 'dark', label: t('settings.theme.dark'), icon: Moon },
    { value: 'light', label: t('settings.theme.light'), icon: Sun },
  ];

  return (
    <SettingsSection title={t('settings.theme.title')}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {themeOptions.map(({ value, label, icon: Icon }) => (
          <button
            type="button"
            key={value}
            onClick={() => setTheme(value)}
            aria-pressed={theme === value}
            className={cn(
              'flex flex-col items-center justify-center gap-2 px-3 py-5 rounded-md transition-colors',
              theme === value ? OPTION_BUTTON.selected : OPTION_BUTTON.default,
            )}
          >
            <Icon
              className={cn(
                'h-5 w-5',
                theme === value ? 'text-foreground' : TEXT_COLOR.muted,
              )}
              aria-hidden="true"
            />
            <span className={TYPOGRAPHY.body.emphasis}>{label}</span>
          </button>
        ))}
      </div>
    </SettingsSection>
  );
});

ThemeSelector.displayName = 'ThemeSelector';

export default ThemeSelector;
