import { Monitor, Moon, Sun } from 'lucide-react';
import { memo } from 'react';

import { cn } from '@/components/lib/utils';

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
              'flex flex-col items-center justify-center gap-2.5 py-6 px-4 rounded-xl transition-all duration-200 ease-spring',
              theme === value
                ? 'bg-muted/50 text-foreground'
                : 'text-muted-foreground/50 hover:bg-muted/25 hover:text-foreground',
            )}
          >
            <Icon
              className={cn(
                'h-5 w-5',
                theme === value ? 'text-primary' : 'opacity-40',
              )}
            />
            <span className="text-[13px] font-medium">{label}</span>
          </button>
        ))}
      </div>
    </SettingsSection>
  );
});

ThemeSelector.displayName = 'ThemeSelector';

export default ThemeSelector;
