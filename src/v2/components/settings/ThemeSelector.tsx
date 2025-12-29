import { Monitor, Moon, Sun } from 'lucide-react';
import { memo } from 'react';

import { cn } from '@/components/lib/utils';
import { TEXT_COLOR, TYPOGRAPHY } from '../../constants/ui';
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
    <SettingsSection icon={Sun} title={t('settings.theme.title')}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {themeOptions.map(({ value, label, icon: Icon }) => (
          <button
            type="button"
            key={value}
            onClick={() => setTheme(value)}
            className={cn(
              'flex items-center justify-center gap-2 p-3 rounded-lg border-2 transition-colors',
              theme === value
                ? 'border-primary bg-primary/10 dark:bg-primary/20'
                : 'border-border hover:border-primary/50',
            )}
          >
            <Icon
              className={cn(
                'h-5 w-5',
                theme === value ? 'text-primary' : TEXT_COLOR.muted,
              )}
            />
            <span
              className={cn(
                TYPOGRAPHY.body.emphasis,
                theme === value ? 'text-primary' : TEXT_COLOR.secondary,
              )}
            >
              {label}
            </span>
          </button>
        ))}
      </div>
    </SettingsSection>
  );
});

ThemeSelector.displayName = 'ThemeSelector';

export default ThemeSelector;
