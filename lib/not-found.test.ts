/**
 * The page for an address the app does not have (owner's review, 2026-10-24).
 *
 *   node lib/not-found.test.ts
 *
 * Expo's default page was English only, ran past a 320-point screen, and linked to `/_sitemap` — a list of every route.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { en } from './i18n/en.ts';
import { fr } from './i18n/fr.ts';
import { ar } from './i18n/ar.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  fn();
  passed++;
};
const code = readFileSync(new URL('../app/+not-found.tsx', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

it('it is the app’s own page: every word from the catalogue, one way on to the start', () => {
  for (const key of ['notFound.title', 'notFound.body', 'notFound.action']) assert.match(code, new RegExp(`t\\('${key.replace('.', '\\.')}'\\)`));
  assert.match(code, /router\.replace\('\/'\)/);
});

it('it names no other address: no sitemap, no link', () => {
  assert.doesNotMatch(code, /_sitemap|<Link|href=/);
});

it('it is said in all three languages', () => {
  for (const key of ['notFound.title', 'notFound.body', 'notFound.action'] as const) {
    assert.ok(en[key] && fr[key] && ar[key]);
    assert.notEqual(fr[key], en[key]);
    assert.notEqual(ar[key], en[key]);
  }
});

console.log(`not found: ${passed} passed`);
