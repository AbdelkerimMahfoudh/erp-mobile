/**
 * Whether a release build may talk to the API origin it was built with (docs/48 control 19; review MO1-04, MO2-05).
 *
 * The same rule as `scripts/verify-release-config.js`, held by the running app too: a phone running a release
 * build never falls back to a development address and never sends a password or a session in clear text. A
 * release whose origin is missing, not https, or a development host is refused before any request leaves — the
 * app shows that it was built without its server instead of failing every screen with "no connection".
 *
 * Pure (no React Native), so it is tested under node:
 *   node lib/release-origin.test.ts
 */
export type OriginRefusal = 'missing' | 'not_https' | 'development_host';

export function releaseOriginRefusal(configured: string | undefined): OriginRefusal | null {
  const origin = (configured ?? '').trim().replace(/\/+$/, '');
  if (!origin) return 'missing';
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origin)) return 'not_https';
  if (/localhost|127\.0\.0\.1|\b10\.\d|\b192\.168\.|\b172\.(1[6-9]|2\d|3[01])\./.test(origin)) return 'development_host';
  return null;
}
