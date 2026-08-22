import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import ar from './locales/ar';
import az from './locales/az';
import bg from './locales/bg';
import de from './locales/de';
import en from './locales/en';
import enGB from './locales/en_GB';
import es from './locales/es';
import fi from './locales/fi';
import fr from './locales/fr';
import he from './locales/he';
import hu from './locales/hu';
import it from './locales/it';
import ja from './locales/ja';
import ko from './locales/ko';
import mn from './locales/mn';
import nl from './locales/nl';
import pl from './locales/pl';
import pt from './locales/pt';
import ptBR from './locales/pt_BR';
import ro from './locales/ro';
import ru from './locales/ru';
import sv from './locales/sv';
import tr from './locales/tr';
import uk from './locales/uk';
import vi from './locales/vi';
import zhCN from './locales/zh_CN';
import zhTW from './locales/zh_TW';

export type LanguageEntry = { code: string; label: string; native: string };

export const LANGUAGES: LanguageEntry[] = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'en_GB', label: 'English (UK)', native: 'English (UK)' },
  { code: 'zh_CN', label: '简体中文', native: '简体中文' },
  { code: 'zh_TW', label: '繁體中文', native: '繁體中文' },
  { code: 'ja', label: '日本語', native: '日本語' },
  { code: 'ko', label: '한국어', native: '한국어' },
  { code: 'de', label: 'Deutsch', native: 'Deutsch' },
  { code: 'es', label: 'Español', native: 'Español' },
  { code: 'fr', label: 'Français', native: 'Français' },
  { code: 'it', label: 'Italiano', native: 'Italiano' },
  { code: 'ru', label: 'Русский', native: 'Русский' },
  { code: 'pt', label: 'Português', native: 'Português' },
  { code: 'pt_BR', label: 'Português (Brasil)', native: 'Português (Brasil)' },
  { code: 'pl', label: 'Polski', native: 'Polski' },
  { code: 'vi', label: 'Tiếng Việt', native: 'Tiếng Việt' },
  { code: 'tr', label: 'Türkçe', native: 'Türkçe' },
  { code: 'uk', label: 'Українська', native: 'Українська' },
  { code: 'nl', label: 'Nederlands', native: 'Nederlands' },
  { code: 'sv', label: 'Svenska', native: 'Svenska' },
  { code: 'ar', label: 'العربية', native: 'العربية' },
  { code: 'az', label: 'Azərbaycanca', native: 'Azərbaycanca' },
  { code: 'bg', label: 'Български', native: 'Български' },
  { code: 'fi', label: 'Suomi', native: 'Suomi' },
  { code: 'he', label: 'עברית', native: 'עברית' },
  { code: 'hu', label: 'Magyar', native: 'Magyar' },
  { code: 'mn', label: 'Монгол', native: 'Монгол' },
  { code: 'ro', label: 'Română', native: 'Română' },
];

const resources = {
  ar: ar, az: az, bg: bg, de: de, en: en, en_GB: enGB,
  es: es, fi: fi, fr: fr, he: he, hu: hu, it: it, ja: ja,
  ko: ko, mn: mn, nl: nl, pl: pl, pt: pt, pt_BR: ptBR,
  ro: ro, ru: ru, sv: sv, tr: tr, uk: uk, vi: vi,
  zh: zhCN, zh_CN: zhCN, zh_TW: zhTW,
};

export const setupI18n = (lng: string = 'en') => {
  void i18n.use(initReactI18next).init({
    resources,
    lng,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });
  return i18n;
};

export default i18n;
