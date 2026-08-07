/**
 * Regression guard for price input (G2A-CP4).
 *
 * Run directly with Node (type-stripping), no test runner or new dependency:
 *   node lib/price-input.test.ts
 * Exits non-zero on any failure.
 *
 * Nothing malformed may reach the API: the server would either reject it with a
 * technical message or, worse, MySQL would silently truncate it into a price
 * nobody chose.
 */
import assert from 'node:assert/strict';
import { parsePrice, canSave } from './price-input.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
};

it('accepts a plain amount', () => {
  assert.deepEqual(parsePrice('17000'), { ok: true, value: 17000 });
  assert.deepEqual(parsePrice('  17000  '), { ok: true, value: 17000 });
});

it('accepts two decimals, the column’s precision', () => {
  assert.deepEqual(parsePrice('17000.5'), { ok: true, value: 17000.5 });
  assert.deepEqual(parsePrice('17000.55'), { ok: true, value: 17000.55 });
});

it('rejects more precision than DECIMAL(14,2) can hold', () => {
  // Truncating silently would charge a price nobody typed.
  assert.deepEqual(parsePrice('17000.555'), { ok: false, reason: 'too_precise' });
});

it('accepts thousands separators the user typed', () => {
  assert.deepEqual(parsePrice('17,000'), { ok: true, value: 17000 });
  assert.deepEqual(parsePrice('17 000'), { ok: true, value: 17000 });
});

it('accepts Arabic-Indic digits, which the Arabic keyboard produces', () => {
  assert.deepEqual(parsePrice('١٧٠٠٠'), { ok: true, value: 17000 });
  assert.deepEqual(parsePrice('۱۷۰۰۰'), { ok: true, value: 17000 });
  assert.deepEqual(parsePrice('١٧٠٠٠٫٥'), { ok: true, value: 17000.5 });
});

it('rejects blank input rather than sending nothing', () => {
  assert.deepEqual(parsePrice(''), { ok: false, reason: 'empty' });
  assert.deepEqual(parsePrice('   '), { ok: false, reason: 'empty' });
});

it('rejects anything that is not a number', () => {
  for (const bad of ['abc', '17k', '1.2.3', '.', '-', '1-2', '17000$']) {
    assert.equal(parsePrice(bad).ok, false, `expected ${bad} to be rejected`);
  }
});

it('never lets NaN or Infinity through', () => {
  assert.equal(parsePrice('NaN').ok, false);
  assert.equal(parsePrice('Infinity').ok, false);
});

it('rejects negative prices', () => {
  assert.deepEqual(parsePrice('-1'), { ok: false, reason: 'negative' });
  assert.deepEqual(parsePrice('-0.01'), { ok: false, reason: 'negative' });
});

it('treats zero as a real price, not as absent', () => {
  // A giveaway is a decision the Owner may take; it is not "no price".
  assert.deepEqual(parsePrice('0'), { ok: true, value: 0 });
});

it('offers Save only for a real change', () => {
  assert.equal(canSave('17000', 17000), false, 'same value is not a change');
  assert.equal(canSave('17000.00', 17000), false, 'same value written differently');
  assert.equal(canSave('17500', 17000), true);
  assert.equal(canSave('', 17000), false, 'blank is not a change');
  assert.equal(canSave('-5', 17000), false, 'invalid is not a change');
  assert.equal(canSave('17000', null), true, 'first price for an unpriced item');
});

console.log(`\n${passed} passed`);
