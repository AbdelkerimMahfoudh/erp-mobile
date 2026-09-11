import { ar, enUS, fr } from 'date-fns/locale';
import type { Locale } from 'date-fns';

/**
 * The calendar a date is written in, per app language.
 *
 * French used to fall through to English, so a French screen read
 * "30 Jul 2026" — month names are words, and words follow the language.
 * Digits stay Latin in every language (see `USE_LATIN_DIGITS`).
 */
export function dateLocaleFor(language: string): Locale {
  if (language === 'ar') return ar;
  if (language === 'fr') return fr;
  return enUS;
}
