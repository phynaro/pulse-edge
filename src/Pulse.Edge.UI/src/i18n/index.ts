import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './locales/en';
import { th } from './locales/th';

const SAVED_LANG_KEY = 'pulse_edge_lang';

const getSavedLanguage = (): string => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(SAVED_LANG_KEY) || 'en';
    }
  } catch {
    // Ignore storage errors in test or SSR envs
  }
  return 'en';
};

const defaultLang = getSavedLanguage();

void i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      th: { translation: th },
    },
    lng: defaultLang,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false, // React already escapes strings
    },
  });

// Set HTML document lang attribute when language changes
if (typeof document !== 'undefined' && document.documentElement) {
  document.documentElement.lang = i18n.language || 'en';
}

i18n.on('languageChanged', (lng) => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(SAVED_LANG_KEY, lng);
    }
  } catch {
    // Ignore storage errors
  }
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = lng;
  }
});

export default i18n;
