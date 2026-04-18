import { memo } from 'react';

import { cn } from '@/components/lib/utils';

import { TYPOGRAPHY } from '../constants/ui';
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
    <SettingsSection title="Language / 言語">
      <div className="grid grid-cols-2 gap-2">
        {languages.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => setLanguage(value)}
            aria-pressed={language === value}
            className={cn(
              'flex items-center justify-center px-3 py-4 rounded-md transition-colors',
              language === value
                ? 'bg-foreground/[0.06] text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.03]',
            )}
          >
            <span className={TYPOGRAPHY.body.emphasis}>{label}</span>
          </button>
        ))}
      </div>
    </SettingsSection>
  );
});

LanguageSelector.displayName = 'LanguageSelector';

export default LanguageSelector;
