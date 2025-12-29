import { Globe2 } from 'lucide-react';
import { memo } from 'react';

import { cn } from '@/components/lib/utils';
import { TEXT_COLOR, TYPOGRAPHY } from '../constants/ui';
import { useI18n } from '../i18n/store';
import type { Language } from '../i18n/types';
import { SettingsSection } from './settings/common';

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
    <SettingsSection icon={Globe2} title="Language / 言語">
      <div className="grid grid-cols-2 gap-3">
        {languages.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => setLanguage(value)}
            className={cn(
              'flex items-center justify-center p-3 rounded-lg border-2 transition-colors',
              language === value
                ? 'border-primary bg-primary/10 dark:bg-primary/20'
                : 'border-border hover:border-primary/50',
            )}
          >
            <span
              className={cn(
                TYPOGRAPHY.body.emphasis,
                language === value ? 'text-primary' : TEXT_COLOR.secondary,
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

LanguageSelector.displayName = 'LanguageSelector';

export default LanguageSelector;
