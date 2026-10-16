/**
 * The app opens only the four legal pages, at their exact in-app addresses, on an https origin it was built with
 * (the owner's brief of 2026-10-16, docs/85).
 *
 *   node lib/legal-links.test.ts
 */
import assert from 'node:assert/strict';
import { isLegalPageUrl, LEGAL_PAGES, legalOrigin, legalPageUrl } from './legal-links.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`FAIL  ${name}`);
    throw e;
  }
};

const ORIGIN = 'https://www.company-domain.mr';

it('the origin is https only, and a release is held to the API’s rule too', () => {
  assert.equal(legalOrigin(undefined, false), null);
  assert.equal(legalOrigin('', true), null);
  assert.equal(legalOrigin('http://www.company-domain.mr', false), null, 'never clear text, even in development');
  assert.equal(legalOrigin('http://www.company-domain.mr', true), null);
  assert.equal(legalOrigin('https://www.company-domain.mr/privacy', true), null, 'an origin, never a path');
  assert.equal(legalOrigin('https://localhost:5173', true), null, 'no development host in a release');
  assert.equal(legalOrigin('https://localhost:5173', false), 'https://localhost:5173');
  assert.equal(legalOrigin(' https://www.company-domain.mr/ ', true), ORIGIN);
});

it('builds the four in-app pages in the three languages, as the website serves them', () => {
  assert.deepEqual([...LEGAL_PAGES], ['privacy', 'terms', 'support', 'accountDeletion']);
  assert.equal(legalPageUrl(ORIGIN, 'privacy', 'en'), `${ORIGIN}/in-app/privacy`);
  assert.equal(legalPageUrl(ORIGIN, 'terms', 'fr'), `${ORIGIN}/fr/in-app/terms`);
  assert.equal(legalPageUrl(ORIGIN, 'support', 'ar'), `${ORIGIN}/ar/in-app/support`);
  assert.equal(legalPageUrl(ORIGIN, 'accountDeletion', 'en'), `${ORIGIN}/in-app/account-deletion`);
});

it('accepts exactly those addresses and nothing else — no other page, host, scheme, query or fragment', () => {
  for (const page of LEGAL_PAGES) for (const lang of ['en', 'fr', 'ar'] as const) assert.equal(isLegalPageUrl(ORIGIN, legalPageUrl(ORIGIN, page, lang)), true);
  for (const url of [
    `${ORIGIN}/privacy`,
    `${ORIGIN}/in-app/apply`,
    `${ORIGIN}/in-app/products/dukan-erp`,
    `${ORIGIN}/account/trial#t=token`,
    `${ORIGIN}/in-app/privacy?t=token`,
    `${ORIGIN}/in-app/privacy#pricing`,
    `${ORIGIN}/in-app/privacy/../apply`,
    'http://www.company-domain.mr/in-app/privacy',
    'https://www.company-domain.mr.example.invalid/in-app/privacy',
    'https://example.invalid/in-app/privacy',
    'tel:+22200000000',
    '',
  ]) {
    assert.equal(isLegalPageUrl(ORIGIN, url), false, url);
  }
  assert.equal(isLegalPageUrl(null, `${ORIGIN}/in-app/privacy`), false, 'no origin configured: nothing opens');
});

console.log(`legal links: ${passed} passed`);
