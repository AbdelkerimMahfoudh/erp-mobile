import { it } from 'node:test';
import assert from 'node:assert/strict';
import { arabicNameHint, displayName, latinNameHint, matchesName, nameIn, nameIncomplete } from './display-name.ts';

/**
 * Bilingual names (D225): the Arabic interface reads the Arabic name, French and English the Latin one, and a
 * record without an Arabic name shows the one it has.
 *
 *   node lib/display-name.test.ts
 */

const shop = { name: 'PS5 Center', nameAr: 'مركز PS5' };
const legacy = { name: 'Boutique Kiffa', nameAr: null };

it('shows the Arabic name in Arabic and the Latin one in French and English', () => {
  assert.equal(displayName(shop, 'ar'), 'مركز PS5');
  assert.equal(displayName(shop, 'fr'), 'PS5 Center');
  assert.equal(displayName(shop, 'en'), 'PS5 Center');
});

it('falls back to the existing name until an Arabic one is given, and marks it', () => {
  assert.equal(displayName(legacy, 'ar'), 'Boutique Kiffa');
  assert.equal(nameIncomplete(legacy), true);
  assert.equal(nameIncomplete(shop), false);
  assert.equal(displayName(null, 'ar'), '');
});

it('finds a record by either name', () => {
  assert.equal(matchesName(shop, 'mrkz'), false);
  assert.equal(matchesName(shop, 'مركز'), true);
  assert.equal(matchesName(shop, 'ps5 cen'), true);
  assert.equal(matchesName(legacy, 'kiffa'), true);
  assert.equal(matchesName(legacy, ''), true);
});

it('guides the script without refusing a real shop name', () => {
  assert.equal(latinNameHint('PS5 Center'), null);
  assert.equal(latinNameHint('Électro Kiffa'), null);
  assert.equal(latinNameHint('مركز'), 'latin_has_arabic');
  assert.equal(latinNameHint('---'), 'latin_needs_letter');
  assert.equal(arabicNameHint('مركز PS5'), null);
  assert.equal(arabicNameHint('PS5 Center'), 'arabic_needs_arabic');
  assert.equal(arabicNameHint(''), null);
});

it('a name sent as two fields reads in the reader’s script, never blank when either exists', () => {
  assert.equal(nameIn('Mariem', 'مريم', 'ar'), 'مريم');
  assert.equal(nameIn('Mariem', 'مريم', 'fr'), 'Mariem');
  assert.equal(nameIn('Mariem', null, 'ar'), 'Mariem');
  assert.equal(nameIn(null, 'مريم', 'en'), 'مريم');
  assert.equal(nameIn(undefined, undefined, 'ar'), '');
});
