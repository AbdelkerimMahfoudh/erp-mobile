import { it } from 'node:test';
import assert from 'node:assert/strict';
import { en } from './en.ts';
import { fr } from './fr.ts';
import { ar } from './ar.ts';

/**
 * No key stays untranslated in silence (D225, the owner's TestFlight feedback of 2026-10-29).
 *
 * The `Catalogue` type already forces every language to have every key. That does not stop a key copied from English
 * and never translated, which the Arabic screens then show in English. This test does:
 *  - every Arabic value carries Arabic letters, unless it holds nothing to translate — placeholders, figures,
 *    punctuation — or only the technical terms listed below, written the same in every language;
 *  - a French value identical to the English one is allowed only for the words the two languages share, listed here
 *    one by one, so a new English sentence copied into French fails until somebody translates it or says why not;
 *  - Arabic never says "Dukan ERP": the product is تطبيق دكان.
 *
 *   node lib/i18n/translation-parity.test.ts
 */

const E = en as unknown as Record<string, string>;
const F = fr as unknown as Record<string, string>;
const R = ar as unknown as Record<string, string>;

const ARABIC = /[؀-ۿ]/;

/** What is left of a value once placeholders, figures, punctuation and the shared technical terms are taken out. */
const TECHNICAL = /\b(IMEI|USB-C|Micro-USB|Lightning|HDMI|iPhone|Pro|Max|PDF|SIM|RAM|Bankily|Sedad|BIM|Bank|TSX-MR)\b/g;
function wordsToTranslate(value: string): string {
  return value
    .replace(/\{[a-zA-Z0-9_]+\}/g, '')
    .replace(TECHNICAL, '')
    .replace(/[\d\s·•×x:%().,/+\-–—…'’"“”«»!?→←]/g, '');
}

/** French words that are the English words, letter for letter. Adding one here is a decision, not a fix. */
const FRENCH_SAME_AS_ENGLISH = new Set([
  'Total', 'Note', 'Description', 'Notifications', 'Stock', 'Transactions', 'Scan', 'Type', 'Date', 'Service',
  'Performance', 'Messages', 'Net', 'Correction', 'Code', 'Commission', 'Smartphones', 'Audio', 'Films', 'Webcams',
  'Consoles', 'Batteries', 'Message', 'Dukan ERP', '1 minute', '5 minutes', '15 minutes', 'Apple, Samsung, Anker…',
  'PDF page {page}', 'Page {page}', 'Important',
]);

it('every language has exactly the same keys', () => {
  const keys = Object.keys(E).sort();
  assert.deepEqual(Object.keys(F).sort(), keys);
  assert.deepEqual(Object.keys(R).sort(), keys);
});

it('every Arabic value is written in Arabic, unless there is nothing in it to translate', () => {
  const untranslated = Object.keys(E).filter((k) => !ARABIC.test(R[k]) && wordsToTranslate(R[k]) !== '');
  assert.deepEqual(untranslated, []);
});

it('no French value is the English sentence copied over', () => {
  const copied = Object.keys(E).filter(
    (k) => F[k] === E[k] && wordsToTranslate(F[k]) !== '' && !FRENCH_SAME_AS_ENGLISH.has(F[k]),
  );
  assert.deepEqual(copied, []);
});

it('Arabic names the product تطبيق دكان, never Dukan ERP', () => {
  assert.deepEqual(Object.keys(R).filter((k) => /Dukan/i.test(R[k])), []);
  assert.equal(R['brand.name'], 'تطبيق دكان');
  assert.equal(R['auth.title'], 'تطبيق دكان');
});

it('every placeholder a sentence uses in English is used in French and Arabic too', () => {
  const slots = (v: string) => [...v.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]).sort();
  const broken = Object.keys(E).flatMap((k) =>
    [['fr', F[k]], ['ar', R[k]]]
      .filter(([, v]) => JSON.stringify(slots(v)) !== JSON.stringify(slots(E[k])))
      .map(([lang]) => `${lang}:${k}`),
  );
  assert.deepEqual(broken, []);
});
