import { I18nManager } from 'react-native';
import { getLocales } from 'expo-localization';
import { create } from 'zustand';
import { deleteItem, getItem, setItem } from '../storage';
import Constants from 'expo-constants';
import { applyWebDirection, DIRECTION_NEEDS_RESTART, isExpoGo, layoutIsRTL } from '../design/layout-direction';
import { directionVerdict, type DirectionVerdict } from '../design/direction-restart';
import { en } from './en';
import { ar } from './ar';
import { fr } from './fr';
import type { Catalogue, TranslationKey, TranslationValues } from './keys';

export type Language = 'en' | 'ar' | 'fr';

const CATALOGUES: Record<Language, Catalogue> = { en, ar, fr };
const RTL_LANGUAGES: ReadonlySet<Language> = new Set<Language>(['ar']);
const LANGUAGE_STORAGE_KEY = 'erp.language';
/**
 * The language a direction flip was last requested for. Read at the next launch:
 * if that launch still shows the old direction, the flip did not take, and the
 * notice must say so rather than ask for another restart forever.
 */
const DIRECTION_REQUEST_KEY = 'erp.language.directionRequestedFor';

/**
 * The request is remembered with the native process it was made in
 * (`Constants.sessionId`, new for every launch of the app). At the next
 * hydration the request counts as "an earlier launch" only when that id has
 * changed: a reload of the JavaScript — Metro, the developer menu — keeps the
 * process and keeps the id, and must not be mistaken for the restart the OS
 * needs to apply a direction (the false "this build cannot switch direction"
 * a reload would otherwise produce in development).
 */
function directionRequest(lang: Language): string {
  return `${lang}@${Constants.sessionId}`;
}

function parseDirectionRequest(stored: string | null): { lang: string; session: string } | null {
  if (!stored) return null;
  const at = stored.indexOf('@');
  // A value written before the session id was recorded: the language alone, from an unknown process.
  return at === -1 ? { lang: stored, session: '' } : { lang: stored.slice(0, at), session: stored.slice(at + 1) };
}

/**
 * Each language named in its own words.
 *
 * Never translated: somebody who has landed in a language they cannot read
 * needs to recognise their own on this list, and "Arabic" spelled in French
 * helps nobody who only reads Arabic.
 */
export const LANGUAGE_LABELS: Record<Language, string> = {
  en: 'English',
  ar: 'العربية',
  fr: 'Français',
};

/** Every language the app ships, in the order the picker shows them. */
export const LANGUAGES: readonly Language[] = ['en', 'fr', 'ar'];

export function isRtlLanguage(lang: Language): boolean {
  return RTL_LANGUAGES.has(lang);
}

function isSupported(value: string | null | undefined): value is Language {
  return value === 'en' || value === 'ar' || value === 'fr';
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
 * On native, read from `I18nManager`, not from the language, because native RTL
 * only takes effect after a restart — during the gap between choosing Arabic and
 * relaunching, the layout is still LTR and the UI must agree with reality, not
 * with intent. On web the document direction applies at once; see
 * `lib/design/layout-direction.ts`.
 */
export function isRTL(): boolean {
  return layoutIsRTL();
}

interface I18nState {
  language: Language;
  /** True once the persisted choice has been read; screens wait on this. */
  ready: boolean;
  /** True exactly when `direction` is `restart` — kept for the screens that only ask that. */
  restartRequired: boolean;
  /** What is true about layout direction right now; see `lib/design/direction-restart.ts`. */
  direction: DirectionVerdict;
  hydrate: () => Promise<void>;
  setLanguage: (lang: Language) => Promise<void>;
}

function applyLanguage(lang: Language): void {
  activeLanguage = lang;
  activeCatalogue = CATALOGUES[lang];
  applyWebDirection(isRtlLanguage(lang), lang);
}

/**
 * Make the native layout direction follow the language, and say what is true.
 *
 * On native the direction is read by the OS at startup, so a change can only be
 * asked for here and applied by the next launch. Whether that launch happened,
 * and whether it took, is what decides the notice:
 *
 *  - direction already matches → nothing to say (and the earlier request is forgotten);
 *  - mismatch, first time → ask the native side, remember for which language, say "restart";
 *  - mismatch at a LATER launch for the same language → the restart happened and
 *    nothing flipped: in Expo Go that is expected; in our own build it means the
 *    native RTL option is missing — either way the words are honest and the
 *    warning stays while the layout is wrong.
 *
 * `afterSwitch` is true when called from the language control, false from
 * hydration: only a hydration can be "a later launch".
 */
async function settleDirection(lang: Language, afterSwitch: boolean): Promise<DirectionVerdict> {
  if (!DIRECTION_NEEDS_RESTART) return 'ok';

  const wantsRtl = isRtlLanguage(lang);
  /*
   * Both flags follow the language, and both are persisted by the native side
   * and read by the OS at the next launch. `allowRTL` is not left permanently on:
   * on Android, an allowed-but-not-forced app follows the PHONE's language, so
   * English or French on an Arabic phone would lay out right-to-left. With the
   * flags set together, the layout follows the app's language and nothing else.
   *
   * No native setting may override this at launch — see `app.json`, where
   * `expo-localization` is configured without `supportsRTL`: that option makes
   * its native module force the device locale's direction before React loads,
   * which silently discarded this request at every launch on iOS (2026-10-06).
   */
  I18nManager.allowRTL(wantsRtl);
  const actualRtl = I18nManager.isRTL;
  const requested = parseDirectionRequest(await getItem(DIRECTION_REQUEST_KEY));

  if (wantsRtl === actualRtl) {
    if (requested) await deleteItem(DIRECTION_REQUEST_KEY);
    return 'ok';
  }

  I18nManager.forceRTL(wantsRtl);
  const relaunchedSinceRequest = !afterSwitch && requested?.lang === lang && requested.session !== Constants.sessionId;
  if (requested?.lang !== lang) await setItem(DIRECTION_REQUEST_KEY, directionRequest(lang));

  return directionVerdict({ needsRestart: true, wantsRtl, actualRtl, isExpoGo: isExpoGo(), relaunchedSinceRequest });
}

export const useI18n = create<I18nState>((set, get) => ({
  language: 'en',
  ready: false,
  restartRequired: false,
  direction: 'ok',

  hydrate: async () => {
    const stored = await getItem(LANGUAGE_STORAGE_KEY);
    const lang = isSupported(stored) ? stored : deviceLanguage();
    applyLanguage(lang);
    const direction = await settleDirection(lang, false);
    set({ language: lang, ready: true, direction, restartRequired: direction === 'restart' });
  },

  setLanguage: async (lang) => {
    if (get().language === lang) return;
    applyLanguage(lang);
    // The choice outlives sign-out, termination and relaunch: it is written here
    // and read by `hydrate`, and nothing in the session code touches this key.
    await setItem(LANGUAGE_STORAGE_KEY, lang);
    const direction = await settleDirection(lang, true);
    set({ language: lang, direction, restartRequired: direction === 'restart' });
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
  return { t, language, isRTL: layoutIsRTL() };
}

export type { TranslationKey, TranslationValues } from './keys';
