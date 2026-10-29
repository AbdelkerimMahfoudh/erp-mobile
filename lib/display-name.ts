/**
 * Which of a business's, a store's or a person's two names to show (D225, 0111).
 *
 * The Arabic interface shows the Arabic name; French and English show the Latin one. A record created before the
 * Arabic name existed — or since, from the released build — has none yet, and then shows the name it has, in every
 * language. It is never blank and never blocked: the Owner is offered to complete it instead.
 *
 * Pure, so the same rule renders a header, a store switcher, a receipt and a notification.
 *
 *   node lib/display-name.test.ts
 */

export interface BilingualName {
  name: string;
  nameAr?: string | null;
}

export function displayName(named: BilingualName | null | undefined, language: string): string {
  if (!named) return '';
  if (language === 'ar' && named.nameAr) return named.nameAr;
  return named.name;
}

/** No Arabic name yet: shown with the Latin one, and marked for the Owner to complete. */
export function nameIncomplete(named: BilingualName | null | undefined): boolean {
  return Boolean(named) && !named?.nameAr;
}

/** Search on both names, so a person typing in either script finds the same record. */
export function matchesName(named: BilingualName, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return true;
  return [named.name, named.nameAr ?? ''].some((n) => n.toLocaleLowerCase().includes(q));
}

/**
 * Script guidance while typing, never a wall: the server's rule (`src/common/bilingual-name.ts`) says the same, and
 * real shop names such as "PS5 Center" or "مركز PS5" pass both.
 */
const ARABIC_LETTER = /[ؠ-يٮ-ۓەۮۯۺ-ۼۿݐ-ݿࢠ-ࣉﭐ-ﷻﹰ-ﻼ]/u;
const LATIN_LETTER_OR_DIGIT = /[A-Za-z0-9À-ÖØ-öø-ɏ]/u;

export type NameHint = 'latin_has_arabic' | 'latin_needs_letter' | 'arabic_needs_arabic' | null;

export function latinNameHint(value: string): NameHint {
  const v = value.trim();
  if (!v) return null;
  if (ARABIC_LETTER.test(v)) return 'latin_has_arabic';
  if (!LATIN_LETTER_OR_DIGIT.test(v)) return 'latin_needs_letter';
  return null;
}

export function arabicNameHint(value: string): NameHint {
  const v = value.trim();
  if (!v) return null;
  return ARABIC_LETTER.test(v) ? null : 'arabic_needs_arabic';
}
