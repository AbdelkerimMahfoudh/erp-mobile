import { Linking, Platform } from 'react-native';

/**
 * Nothing in the app opens an address outside it (docs/21: the App Store
 * boundary of 2026-10-05; the owner's correction of 2026-10-13 — no website
 * link, no browser). The root layout installs this once, at startup, before
 * any screen exists.
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
 * itself — an anchor, `location` — cannot be refused from here; the source
 * boundary test holds every navigation target to the app's own routes and
 * bans those calls, and the bundle audit pins the libraries' own.
 *
 * `lib/access-boundary.test.ts` pins this file and its call in
 * `app/_layout.tsx`; `scripts/audit-bundle.js` refuses a bundle without it.
 */
export function refuseBrowser(): void {
  Linking.openURL = () => Promise.reject(new Error('Dukan ERP opens no address outside the app.'));
  // The web export renders its pages once in Node, where there is no window to guard.
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const open = window.open.bind(window);
    window.open = (url, ...rest) => (String(url ?? '').startsWith('blob:') ? open(url, ...rest) : null);
  }
}
