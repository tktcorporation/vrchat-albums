import { Monitor, Moon, Sun } from 'lucide-react';
import { memo } from 'react';
import { useTheme } from '../../hooks/useTheme';
import { useI18n } from '../../i18n/store';
import type { ThemeOption } from '../../utils/theme';

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
    <section>
      <h3 className="flex items-center text-lg font-medium text-gray-900 dark:text-white mb-4">
        <Sun className="h-5 w-5 mr-2 text-indigo-600 dark:text-indigo-400" />
        {t('settings.theme.title')}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {themeOptions.map(({ value, label, icon: Icon }) => (
          <button
            type="button"
            key={value}
            onClick={() => setTheme(value)}
            className={`flex items-center justify-center gap-2 p-3 rounded-lg border-2 transition-colors ${
              theme === value
                ? 'border-indigo-600 dark:border-indigo-400 bg-indigo-50 dark:bg-indigo-900/20'
                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
            }`}
          >
            <Icon
              className={`h-5 w-5 ${
                theme === value
                  ? 'text-indigo-600 dark:text-indigo-400'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            />
            <span
              className={`text-sm font-medium ${
                theme === value
                  ? 'text-indigo-600 dark:text-indigo-400'
                  : 'text-gray-700 dark:text-gray-300'
              }`}
            >
              {label}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
});

ThemeSelector.displayName = 'ThemeSelector';

export default ThemeSelector;
