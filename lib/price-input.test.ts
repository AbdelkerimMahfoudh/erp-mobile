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
import { parsePrice, canSave, parseAmount, maskAmount } from './price-input.ts';

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

it('the money field keeps Arabic-Indic digits as ASCII, one point, and a minus only where the figure may be below zero', () => {
  assert.equal(maskAmount('١٢٣٤'), '1234', 'the Arabic keyboard types an amount, not nothing');
  assert.equal(maskAmount('۱۲۳۴'), '1234');
  assert.equal(maskAmount('١٢٫٥'), '12.5', 'the Arabic decimal separator is a point');
  assert.equal(maskAmount('12,5'), '12.5', 'a comma is the French decimal separator');
  assert.equal(maskAmount('1.2.3'), '1.23', 'a second separator is dropped as typed, as before');
  assert.equal(maskAmount('12a3'), '123');
  assert.equal(maskAmount('-300'), '300', 'no minus where a figure cannot be below zero');
  assert.equal(maskAmount('-300', true), '-300', 'an account’s net movement may be');
  assert.equal(maskAmount('-٣٠٠', true), '-300');
  assert.equal(maskAmount('3-00', true), '300', 'a minus counts only at the start');
  assert.equal(maskAmount('', true), '');
});

it('a counted amount is parsed as strictly as a price, and signed only where allowed', () => {
  assert.deepEqual(parseAmount('١٢٣٤'), { ok: true, value: 1234 });
  assert.deepEqual(parseAmount('-300', { allowNegative: true }), { ok: true, value: -300 });
  assert.deepEqual(parseAmount('-300'), { ok: false, reason: 'negative' });
  assert.deepEqual(parseAmount('-0.5', { allowNegative: true }), { ok: true, value: -0.5 });
  for (const bad of ['.', '-', '-.', '1.2.3', 'NaN', 'Infinity', '--3']) {
    assert.equal(parseAmount(bad, { allowNegative: true }).ok, false, `expected ${bad} to be refused`);
  }
  assert.deepEqual(parseAmount('12.345', { allowNegative: true }), { ok: false, reason: 'too_precise' });
  assert.deepEqual(parseAmount('   '), { ok: false, reason: 'empty' });
  assert.deepEqual(parsePrice('-300'), { ok: false, reason: 'negative' }, 'a price stays unsigned');
});

console.log(`\n${passed} passed`);
