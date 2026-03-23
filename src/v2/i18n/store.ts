import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import en from './locales/en';
import ja from './locales/ja';
import type { Language, TranslationKey, Translations } from './types';

const translations: Record<Language, Translations> = { en, ja };

interface I18nState {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: TranslationKey) => string;
}

/**
 * UI 文言の多言語化を実現する zustand ストア。
 * 各コンポーネントから useI18n() で呼び出され、翻訳文字列を提供する。
 */
export const useI18n = create<I18nState>()(
  persist<I18nState>(
    (set, get) => ({
      language: 'ja',
      setLanguage: (language) => set({ language }),
      t: (key) => {
        const { language } = get();
        const translation = translations[language];
        const keys = key.split('.');

        let current: unknown = translation;

        for (const k of keys) {
          if (typeof current === 'object' && current !== null && k in current) {
            current = (current as Record<string, unknown>)[k];
          } else {
            return key; // 見つからなければキーをそのまま返す
          }
        }

        return typeof current === 'string' ? current : key; // 最終結果が文字列なら返す
      },
    }),
    {
      name: 'photo-gallery-language',
    },
  ),
);
