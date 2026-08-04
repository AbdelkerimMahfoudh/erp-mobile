import { I18nManager } from 'react-native';
import { getLocales } from 'expo-localization';
import { create } from 'zustand';
import { getItem, setItem } from '../storage';
import { en } from './en';
import { ar } from './ar';
import type { Catalogue, TranslationKey, TranslationValues } from './keys';

export type Language = 'en' | 'ar';

const CATALOGUES: Record<Language, Catalogue> = { en, ar };
const RTL_LANGUAGES: ReadonlySet<Language> = new Set<Language>(['ar']);
const LANGUAGE_STORAGE_KEY = 'erp.language';

export const LANGUAGE_LABELS: Record<Language, string> = {
  en: 'English',
  ar: 'العربية',
};

export function isRtlLanguage(lang: Language): boolean {
  return RTL_LANGUAGES.has(lang);
}

function isSupported(value: string | null | undefined): value is Language {
  return value === 'en' || value === 'ar';
}

/** Best guess from the device before the user has chosen explicitly. */
function deviceLanguage(): Language {
  for (const locale of getLocales()) {
    if (isSupported(locale.languageCode)) return locale.languageCode;
  }
  return 'en';
}

/**
 * Module-level mirror of the active catalogue.
 *
 * `t()` must be callable from places that are not React components — error
 * mappers, the API client, imperative toasts — so translation cannot live in
 * context alone.
 */
let activeLanguage: Language = 'en';
let activeCatalogue: Catalogue = en;

/**
 * Translate a key, filling `{placeholders}` from `values`.
 *
 * A missing key falls back to English and then to the key itself: a screen in
 * an unfinished locale degrades to readable English rather than a blank label
 * in front of a customer.
 */
export function t(key: TranslationKey, values?: TranslationValues): string {
  const template = activeCatalogue[key] ?? en[key] ?? key;
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}

export function getLanguage(): Language {
  return activeLanguage;
}

/**
 * Whether the UI is laid out right-to-left.
 *
 * Read from `I18nManager`, not from the language, because native RTL only takes
 * effect after a restart — during the gap between choosing Arabic and relaunching,
 * the layout is still LTR and the UI must agree with reality, not with intent.
 */
export function isRTL(): boolean {
  return I18nManager.isRTL;
}

interface I18nState {
  language: Language;
  /** True once the persisted choice has been read; screens wait on this. */
  ready: boolean;
  /** Set when the chosen language needs a relaunch to flip layout direction. */
  restartRequired: boolean;
  hydrate: () => Promise<void>;
  setLanguage: (lang: Language) => Promise<void>;
}

function applyLanguage(lang: Language): void {
  activeLanguage = lang;
  activeCatalogue = CATALOGUES[lang];
}

export const useI18n = create<I18nState>((set, get) => ({
  language: 'en',
  ready: false,
  restartRequired: false,

  hydrate: async () => {
    const stored = await getItem(LANGUAGE_STORAGE_KEY);
    const lang = isSupported(stored) ? stored : deviceLanguage();
    applyLanguage(lang);

    // Permit RTL at all; without this, forceRTL is ignored on some builds.
    I18nManager.allowRTL(true);
    const wantsRtl = isRtlLanguage(lang);
    if (I18nManager.isRTL !== wantsRtl) {
      I18nManager.forceRTL(wantsRtl);
      // Direction is applied natively at startup, so the running session keeps
      // its current direction. The next launch is correct.
      set({ language: lang, ready: true, restartRequired: true });
      return;
    }
    set({ language: lang, ready: true, restartRequired: false });
  },

  setLanguage: async (lang) => {
    if (get().language === lang) return;
    applyLanguage(lang);
    await setItem(LANGUAGE_STORAGE_KEY, lang);

    const wantsRtl = isRtlLanguage(lang);
    const directionChanges = I18nManager.isRTL !== wantsRtl;
    if (directionChanges) {
      I18nManager.allowRTL(true);
      I18nManager.forceRTL(wantsRtl);
    }
    set({ language: lang, restartRequired: directionChanges });
  },
}));

/**
 * Translate inside a component. Subscribing to `language` is what re-renders
 * the tree when the catalogue changes — `t` alone is a module function and
 * would otherwise leave stale strings on screen.
 */
export function useTranslation(): {
  t: typeof t;
  language: Language;
  isRTL: boolean;
} {
  const language = useI18n((s) => s.language);
  return { t, language, isRTL: I18nManager.isRTL };
}

export type { TranslationKey, TranslationValues } from './keys';
