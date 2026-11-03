import { getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min';
import { COUNTRY_NAMES } from './phone-country-names.ts';
/**
 * A contact's phone number as a person types it and as the server stores it (D227). The field holds a country and the
 * national digits; everything leaving it is one international string. The server's `normalisePhone` stays the authority.
 * Pure:
 *
 *   node lib/phone-input.test.ts
 */
export interface PhoneCountry {
  iso: string;
  code: string;
  en: string;
  fr: string;
  ar: string;
}

export const DEFAULT_COUNTRY = 'MR';

/*
 * Every country and territory with a calling code (post-Build-4): the codes from `libphonenumber-js`, whose metadata
 * derives from Google's libphonenumber project; the names in English, French and Arabic generated from `i18n-iso-countries`
 * (`lib/phone-country-names.ts`, so only those three locales reach the app).
 */
export const PHONE_COUNTRIES: readonly PhoneCountry[] = COUNTRY_NAMES.map(([iso, en, fr, ar]) => ({ iso, code: getCountryCallingCode(iso as CountryCode), en, fr, ar }));

const BY_ISO = new Map(PHONE_COUNTRIES.map((c) => [c.iso, c]));

export function countryOf(iso: string): PhoneCountry {
  return BY_ISO.get(iso) ?? BY_ISO.get(DEFAULT_COUNTRY)!;
}

/** Folded for search: case, accents and Arabic diacritics set aside. */
const fold = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f\u064b-\u0652]/g, '').toLowerCase().trim();

/** Mauritania first (the owner, 2026-11-03), then every other country in the reading language's alphabetical order. */
export function countriesFor(language: string): PhoneCountry[] {
  const collator = new Intl.Collator(language === 'ar' ? 'ar' : language === 'fr' ? 'fr' : 'en', { sensitivity: 'base' });
  const rest = PHONE_COUNTRIES.filter((c) => c.iso !== DEFAULT_COUNTRY).sort((a, b) => collator.compare(countryName(a, language), countryName(b, language)));
  return [countryOf(DEFAULT_COUNTRY), ...rest];
}

/**
 * What a search finds: the name in the reading language or in English, the ISO code, or the calling code (`+1`, `1`,
 * `00222`). A shared code finds every country that uses it.
 */
export function searchCountries(list: readonly PhoneCountry[], query: string, language: string): PhoneCountry[] {
  const q = fold(query);
  if (q === '') return [...list];
  const digits = q.replace(/^(\+|00)/, '');
  const dialing = /^(\+|00)?\d+$/.test(q);
  return list.filter((c) =>
    dialing ? c.code.startsWith(digits) : fold(countryName(c, language)).includes(q) || fold(c.en).includes(q) || c.iso.toLowerCase() === q,
  );
}

export function countryName(country: PhoneCountry, language: string): string {
  return language === 'ar' ? country.ar : language === 'fr' ? country.fr : country.en;
}

/** Spaces and punctuation go; Arabic-Indic digits become the digits the server reads. */
function tidy(raw: string): string {
  return raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\s\-().]/g, '');
}

/** True while the person is writing the whole number themselves: its country is in what they typed. */
export function typedInternational(raw: string): boolean {
  const s = tidy(raw);
  return s.startsWith('+') || s.startsWith('00');
}

/** One string for the server, or empty when nothing is typed. What cannot be a number is passed on for the form to refuse. */
export function composePhone(iso: string, typed: string): string {
  const s = tidy(typed);
  if (s === '') return '';
  if (s.startsWith('+')) return s;
  if (s.startsWith('00')) return `+${s.slice(2)}`;
  if (!/^\d+$/.test(s)) return s;
  return `+${countryOf(iso).code}${s.replace(/^0+/, '')}`;
}

/** A stored number back into the field. A code not in the list stays whole, so nothing is ever guessed. */
export function splitPhone(value: string, fallbackIso: string = DEFAULT_COUNTRY): { iso: string; national: string } {
  const s = tidy(value);
  if (!s.startsWith('+')) return { iso: fallbackIso, national: value };
  const digits = s.slice(1);
  // A shared code (+1, +7, +44…): the number itself says which country, when it can; else the one already chosen.
  const parsed = parsePhoneNumberFromString(s);
  if (parsed?.country && BY_ISO.has(parsed.country)) return { iso: parsed.country, national: digits.slice(BY_ISO.get(parsed.country)!.code.length) };
  const fallback = BY_ISO.get(fallbackIso);
  if (fallback && digits.startsWith(fallback.code)) return { iso: fallback.iso, national: digits.slice(fallback.code.length) };
  // Longest first: `1` must not take what belongs to a longer code.
  const match = [...PHONE_COUNTRIES].sort((a, b) => b.code.length - a.code.length).find((c) => digits.startsWith(c.code));
  return match ? { iso: match.iso, national: digits.slice(match.code.length) } : { iso: fallbackIso, national: s };
}
