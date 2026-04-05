import { create } from 'zustand';
import { zh } from './zh';
import { en } from './en';

export type Locale = 'zh' | 'en';

interface I18nStore {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

function resolveInitialLocale(): Locale {
  try {
    const stored = localStorage.getItem('locale');
    if (stored === 'zh' || stored === 'en') return stored;
  } catch {
    // ignore localStorage access errors
  }

  if (typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh')) {
    return 'zh';
  }

  return 'en';
}

function getTranslations(locale: Locale) {
  return locale === 'en' ? en : zh;
}

function translate(locale: Locale, key: string): string {
  const primary = getTranslations(locale);
  if (key in primary) return primary[key];

  const fallback = getTranslations(locale === 'en' ? 'zh' : 'en');
  if (key in fallback) return fallback[key];

  return key;
}

export const useI18n = create<I18nStore>((set) => ({
  locale: resolveInitialLocale(),
  setLocale: (locale) => {
    localStorage.setItem('locale', locale);
    set({ locale });
  },
}));

/** Non-reactive translation helper (use outside React components) */
export function t(key: string): string {
  return translate(useI18n.getState().locale, key);
}

/** Reactive translation hook (use inside React components) */
export function useT() {
  const locale = useI18n((s) => s.locale);
  return (key: string): string => translate(locale, key);
}
