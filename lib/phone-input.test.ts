import assert from 'node:assert/strict';
import { test } from 'node:test';
import { composePhone, countryName, countryOf, PHONE_COUNTRIES, splitPhone, typedInternational } from './phone-input.ts';

test('the default country gives the local number its code', () => {
  assert.equal(composePhone('MR', '22 12 34 56'), '+22222123456');
});

test('nothing typed is nothing sent', () => {
  assert.equal(composePhone('MR', '   '), '');
});

test('a chosen country, and its trunk zero dropped', () => {
  assert.equal(composePhone('FR', '06 12 34 56 78'), '+33612345678');
});

test('a number written whole keeps its own country', () => {
  assert.equal(composePhone('MR', '+33 6 12 34 56 78'), '+33612345678');
  assert.equal(composePhone('MR', '0033612345678'), '+33612345678');
  assert.equal(typedInternational(' +33'), true);
  assert.equal(typedInternational('22'), false);
});

test('Arabic-Indic digits are digits', () => {
  assert.equal(composePhone('MR', '٢٢١٢٣٤٥٦'), '+22222123456');
});

test('what is not a number is left for the form to refuse', () => {
  assert.equal(composePhone('MR', 'call me'), 'callme');
});

test('a stored number splits back, and round-trips', () => {
  for (const c of PHONE_COUNTRIES) {
    const stored = `+${c.code}12345678`;
    const { iso, national } = splitPhone(stored);
    assert.equal(composePhone(iso, national), stored);
  }
  assert.deepEqual(splitPhone('+22222123456'), { iso: 'MR', national: '22123456' });
});

test('a code not in the list is never guessed', () => {
  assert.deepEqual(splitPhone('+99912345678'), { iso: 'MR', national: '+99912345678' });
  assert.equal(composePhone('MR', '+99912345678'), '+99912345678');
});

test('every country is named in all three languages, with its own code', () => {
  assert.equal(new Set(PHONE_COUNTRIES.map((c) => c.code)).size, PHONE_COUNTRIES.length);
  for (const language of ['en', 'fr', 'ar']) {
    for (const c of PHONE_COUNTRIES) assert.ok(countryName(c, language).length > 0);
  }
  assert.equal(countryOf('nowhere').iso, 'MR');
});
