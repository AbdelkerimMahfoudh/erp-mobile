import { releaseOriginRefusal } from './release-origin.ts';

/**
 * The four public pages the app may open (the owner's brief of 2026-10-16, docs/85): the privacy policy, the terms,
 * support and account deletion — each in the person's language, at its in-app address on the Dukan ERP website
 * (`/in-app/…`, `/fr/in-app/…`, `/ar/in-app/…`), which shows the same text with no sign-in, no application, no price and
 * no way on to the rest of the site.
 *
 * Opened in the phone's own browser by `openLegalPage` (`lib/navigation/no-browser.ts`), which opens nothing but an
 * exact address this module builds: every other address stays refused.
 *
 * Pure (no React Native), so it is tested under node:
 *   node lib/legal-links.test.ts
 */
export const LEGAL_PAGES = ['privacy', 'terms', 'support', 'accountDeletion'] as const;
export type LegalPage = (typeof LEGAL_PAGES)[number];
type Language = 'en' | 'fr' | 'ar';

const PATH: Record<LegalPage, string> = {
  privacy: '/privacy',
  terms: '/terms',
  support: '/support',
  accountDeletion: '/account-deletion',
};
const PREFIX: Record<Language, string> = { en: '', fr: '/fr', ar: '/ar' };

/**
 * The website's origin as this build may use it, or null — and then the app shows no page to open. Always https; a
 * release is also held to the API's rule (no development host), and `scripts/verify-release-config.js` refuses a
 * release built without it.
 */
export function legalOrigin(configured: string | undefined, release: boolean): string | null {
  const origin = (configured ?? '').trim().replace(/\/+$/, '');
  if (release) return releaseOriginRefusal(origin) ? null : origin;
  return /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origin) ? origin : null;
}

export function legalPageUrl(origin: string, page: LegalPage, language: Language): string {
  return `${origin}${PREFIX[language]}/in-app${PATH[page]}`;
}

/** Whether `url` is exactly one of the pages above, in one of the three languages, on `origin`. */
export function isLegalPageUrl(origin: string | null, url: string): boolean {
  if (!origin) return false;
  return LEGAL_PAGES.some((page) => (Object.keys(PREFIX) as Language[]).some((language) => legalPageUrl(origin, page, language) === url));
}
