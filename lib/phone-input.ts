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

export const PHONE_COUNTRIES: readonly PhoneCountry[] = [
  { iso: 'MR', code: '222', en: 'Mauritania', fr: 'Mauritanie', ar: 'موريتانيا' },
  { iso: 'SN', code: '221', en: 'Senegal', fr: 'Sénégal', ar: 'السنغال' },
  { iso: 'ML', code: '223', en: 'Mali', fr: 'Mali', ar: 'مالي' },
  { iso: 'MA', code: '212', en: 'Morocco', fr: 'Maroc', ar: 'المغرب' },
  { iso: 'DZ', code: '213', en: 'Algeria', fr: 'Algérie', ar: 'الجزائر' },
  { iso: 'TN', code: '216', en: 'Tunisia', fr: 'Tunisie', ar: 'تونس' },
  { iso: 'GM', code: '220', en: 'Gambia', fr: 'Gambie', ar: 'غامبيا' },
  { iso: 'GN', code: '224', en: 'Guinea', fr: 'Guinée', ar: 'غينيا' },
  { iso: 'CI', code: '225', en: 'Côte d’Ivoire', fr: 'Côte d’Ivoire', ar: 'ساحل العاج' },
  { iso: 'NG', code: '234', en: 'Nigeria', fr: 'Nigéria', ar: 'نيجيريا' },
  { iso: 'SA', code: '966', en: 'Saudi Arabia', fr: 'Arabie saoudite', ar: 'السعودية' },
  { iso: 'AE', code: '971', en: 'United Arab Emirates', fr: 'Émirats arabes unis', ar: 'الإمارات' },
  { iso: 'QA', code: '974', en: 'Qatar', fr: 'Qatar', ar: 'قطر' },
  { iso: 'TR', code: '90', en: 'Türkiye', fr: 'Turquie', ar: 'تركيا' },
  { iso: 'CN', code: '86', en: 'China', fr: 'Chine', ar: 'الصين' },
  { iso: 'FR', code: '33', en: 'France', fr: 'France', ar: 'فرنسا' },
  { iso: 'ES', code: '34', en: 'Spain', fr: 'Espagne', ar: 'إسبانيا' },
  { iso: 'IT', code: '39', en: 'Italy', fr: 'Italie', ar: 'إيطاليا' },
  { iso: 'BE', code: '32', en: 'Belgium', fr: 'Belgique', ar: 'بلجيكا' },
  { iso: 'DE', code: '49', en: 'Germany', fr: 'Allemagne', ar: 'ألمانيا' },
  { iso: 'GB', code: '44', en: 'United Kingdom', fr: 'Royaume-Uni', ar: 'المملكة المتحدة' },
  { iso: 'US', code: '1', en: 'United States / Canada', fr: 'États-Unis / Canada', ar: 'الولايات المتحدة / كندا' },
];

export function countryOf(iso: string): PhoneCountry {
  return PHONE_COUNTRIES.find((c) => c.iso === iso) ?? PHONE_COUNTRIES[0]!;
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
  // Longest first: `1` must not take what belongs to a longer code.
  const match = [...PHONE_COUNTRIES].sort((a, b) => b.code.length - a.code.length).find((c) => digits.startsWith(c.code));
  return match ? { iso: match.iso, national: digits.slice(match.code.length) } : { iso: fallbackIso, national: s };
}
