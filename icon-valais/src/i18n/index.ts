import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';

import fr from './locales/fr.json';
import de from './locales/de.json';
import en from './locales/en.json';
import ru from './locales/ru.json';

export type Lang = 'fr' | 'de' | 'en' | 'ru';

export const LANGS: readonly Lang[] = ['fr', 'de', 'en', 'ru'];
export const DEFAULT_LANG: Lang = 'fr';

const isLang = (value: unknown): value is Lang =>
  typeof value === 'string' && (LANGS as readonly string[]).includes(value);

function deviceLang(): Lang {
  try {
    const code = getLocales()[0]?.languageCode;
    return isLang(code) ? code : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}

export async function initI18n(lang?: Lang): Promise<void> {
  const lng = lang ?? deviceLang();
  if (i18n.isInitialized) {
    await i18n.changeLanguage(lng);
    return;
  }
  await i18n.use(initReactI18next).init({
    resources: {
      fr: { translation: fr },
      de: { translation: de },
      en: { translation: en },
      ru: { translation: ru },
    },
    lng,
    fallbackLng: DEFAULT_LANG,
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}

export default i18n;
