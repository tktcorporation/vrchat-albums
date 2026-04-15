import { Monitor, Moon, Sun } from 'lucide-react';
import { memo } from 'react';

import { cn } from '@/components/lib/utils';

import { TYPOGRAPHY } from '../../constants/ui';
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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {themeOptions.map(({ value, label, icon: Icon }) => (
          <button
            type="button"
            key={value}
            onClick={() => setTheme(value)}
            className={cn(
              'flex items-center justify-center gap-2 p-3 rounded-xl transition-all duration-200 ease-spring',
              theme === value
                ? 'bg-muted/70 shadow-subtle text-foreground'
                : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
            )}
          >
            <Icon
              className={cn(
                'h-4 w-4',
                theme === value ? 'text-primary' : 'text-muted-foreground/50',
              )}
            />
            <span className={cn(TYPOGRAPHY.body.emphasis)}>{label}</span>
          </button>
        ))}
      </div>
    </SettingsSection>
  );
});

ThemeSelector.displayName = 'ThemeSelector';

export default ThemeSelector;
