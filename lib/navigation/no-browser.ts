import { Linking, Platform } from 'react-native';
import { LEGAL_ORIGIN } from '../../constants/config';
import type { Language } from '../i18n';
import { isLegalPageUrl, legalPageUrl, type LegalPage } from '../legal-links';

/**
 * Nothing in the app opens an address outside it (docs/21: the App Store
 * boundary of 2026-10-05; the owner's correction of 2026-10-13 — no website
 * link, no browser) but the four legal pages (the owner's brief of
 * 2026-10-16), which `openLegalPage` opens in the phone's own browser. The
 * root layout installs this once, at startup, before any screen exists.
 *
 * On a phone every way out reaches one `openURL`: React Native's `Linking` —
 * expo-linking's `openURL` calls it, and expo-router calls that for an
 * external `href` or redirect. It refuses here, for every address, however the
 * call was spelled, so a server's value passed to `<Link href>` or
 * `router.push` opens nothing. A refusal is a rejected promise, as `openURL`
 * answers when no app can open an address.
 *
 * On the web build a new tab opens only for the app's own `blob:` page — the
 * report preview (`lib/report-pdf.ts`); any other address is refused the way a
 * browser refuses a pop-up (`null`), whether `window.open` was reached by name,
 * through an alias or through `document.defaultView`. A page that navigates
 * itself — an anchor, `location`, and expo-router's external `href`, whose web
 * `openURL` (expo-linking's own) sets `window.location` — cannot be refused
 * from here; the source boundary test holds every navigation target to the
 * app's own routes, reaches a router only through its own methods and bans
 * those calls, and the bundle audit pins the libraries' own.
 *
 * The phone's own opener is kept here, before it is replaced, and reached only
 * by `openLegalPage`, which opens nothing but an exact address
 * `lib/legal-links.ts` builds on the configured origin: never a server's value,
 * never a page with a price, an application or a sign-in.
 *
 * `lib/access-boundary.test.ts` pins this file and its call in
 * `app/_layout.tsx`; `scripts/audit-bundle.js` refuses a bundle without it.
 */
let legalOpener: ((url: string) => Promise<unknown>) | null = null;

export function refuseBrowser(): void {
  const phone = Linking.openURL.bind(Linking);
  Linking.openURL = () => Promise.reject(new Error('Dukan ERP opens no address outside the app.'));
  let tab: ((url: string) => Promise<unknown>) | null = null;
  // The web export renders its pages once in Node, where there is no window to guard.
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const open = window.open.bind(window);
    window.open = (url, ...rest) => (String(url ?? '').startsWith('blob:') ? open(url, ...rest) : null);
    tab = (url) => Promise.resolve(open(url, '_blank', 'noopener,noreferrer'));
  }
  // Kept from the first install only: a second one would keep the refusal.
  legalOpener ??= tab ?? phone;
}

/**
 * The app's own page in iOS Settings — the one place outside the app it may open besides the legal pages (D225, the
 * owner's brief of 2026-10-30). After iOS refused the camera or notifications it will not ask again, and the person
 * can only turn them on there; this takes them to exactly that page. `openSettings` opens no address and takes none:
 * it is not `openURL`, which stays refused. Reached only by `PermissionExplainer` (`lib/access-boundary.test.ts`).
 */
export function openAppSettings(): Promise<void> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return Promise.reject(new Error('No settings page on this platform.'));
  return Linking.openSettings();
}

/** Whether this build has a legal page to open: false when no origin is configured. */
export function legalPagesAvailable(): boolean {
  return LEGAL_ORIGIN !== null;
}

/** Open one legal page, in the person's language, in the phone's own browser — and nothing else. */
export function openLegalPage(page: LegalPage, language: Language): Promise<unknown> {
  const url = LEGAL_ORIGIN ? legalPageUrl(LEGAL_ORIGIN, page, language) : '';
  if (!legalOpener || !isLegalPageUrl(LEGAL_ORIGIN, url)) return Promise.reject(new Error('Dukan ERP opens no address outside the app.'));
  return legalOpener(url);
}
