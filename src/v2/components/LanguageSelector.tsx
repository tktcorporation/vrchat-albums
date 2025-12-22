import { Globe2 } from 'lucide-react';
import { memo } from 'react';
import { useI18n } from '../i18n/store';
import type { Language } from '../i18n/types';

const languages: { value: Language; label: string }[] = [
  { value: 'ja', label: '日本語' },
  { value: 'en', label: 'English' },
];

/**
 * UI の表示言語を選択するコンポーネント。
 * SettingsModal の言語タブとして表示される。
 */
const LanguageSelector = memo(() => {
  const { language, setLanguage } = useI18n();

  return (
    <section>
      <h3 className="flex items-center text-lg font-medium text-gray-900 dark:text-white mb-4">
        <Globe2 className="h-5 w-5 mr-2 text-indigo-600 dark:text-indigo-400" />
        Language / 言語
      </h3>
      <div className="grid grid-cols-2 gap-3">
        {languages.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => setLanguage(value)}
            className={`flex items-center justify-center p-3 rounded-lg border-2 transition-colors ${
              language === value
                ? 'border-indigo-600 dark:border-indigo-400 bg-indigo-50 dark:bg-indigo-900/20'
                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
            }`}
          >
            <span
              className={`text-sm font-medium ${
                language === value
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

LanguageSelector.displayName = 'LanguageSelector';

export default LanguageSelector;
