/**
 * The payer number's rule (D151), mirrored by the server's
 * `erp-backend/src/sales/payer-number.spec.ts` on the same cases.
 *
 * Run directly with Node (type-stripping): node lib/payer-number.test.ts
 */
import assert from 'node:assert/strict';
import { parsePayerNumber, payerNumberField, PAYER_NUMBER_MAX_DIGITS } from './payer-number.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
};

it('optional: empty, blank or missing is no payer number at all', () => {
  for (const raw of ['', '   ', ' ', null, undefined]) {
    assert.deepEqual(parsePayerNumber(raw), { ok: true, value: null });
  }
});

it('a plain number is kept exactly', () => {
  assert.deepEqual(parsePayerNumber('36123456'), { ok: true, value: '36123456' });
  assert.deepEqual(parsePayerNumber('+22236123456'), { ok: true, value: '+22236123456' });
});

it('spaces and hyphens as people group them are presentation, and dropped', () => {
  assert.deepEqual(parsePayerNumber(' +222 36 12-34-56 '), { ok: true, value: '+22236123456' });
  assert.deepEqual(parsePayerNumber('36 12 34 56'), { ok: true, value: '36123456' });
  assert.deepEqual(parsePayerNumber('36–12−34'), { ok: true, value: '361234' });
});

it('no digit is guessed, added or removed: 00 stays 00, no country code appears', () => {
  assert.deepEqual(parsePayerNumber('00222 36 12 34 56'), { ok: true, value: '0022236123456' });
  assert.deepEqual(parsePayerNumber('0036'), { ok: true, value: '0036' });
});

it('Arabic-Indic and Extended Arabic-Indic digits read as the same digits; direction marks vanish', () => {
  assert.deepEqual(parsePayerNumber('٣٦١٢٣٤٥٦'), { ok: true, value: '36123456' });
  assert.deepEqual(parsePayerNumber('۳۶ ۱۲'), { ok: true, value: '3612' });
  assert.deepEqual(parsePayerNumber('‎+222‏ 36'), { ok: true, value: '+22236' });
});

it('refused: a letter, a dot, a bracket, a + that is not first, a number with no digit', () => {
  for (const raw of ['36A12345', 'MR13 0002', '36.12.34', '(222) 36', '36+12', '++36', '+', '-', ' - ']) {
    assert.deepEqual(parsePayerNumber(raw), { ok: false, reason: 'invalid' }, raw);
  }
});

it(`at most ${PAYER_NUMBER_MAX_DIGITS} digits; a leading + does not count`, () => {
  const max = '1'.repeat(PAYER_NUMBER_MAX_DIGITS);
  assert.deepEqual(parsePayerNumber(max), { ok: true, value: max });
  assert.deepEqual(parsePayerNumber(`+${max}`), { ok: true, value: `+${max}` });
  assert.deepEqual(parsePayerNumber(`${max}1`), { ok: false, reason: 'too_long' });
});

it('the request field: cash never sends one, blank sends none, an account sends it normalised', () => {
  assert.deepEqual(payerNumberField('cash', '36 12 34 56'), {});
  assert.deepEqual(payerNumberField('mobile', ''), {});
  assert.deepEqual(payerNumberField('mobile', '   '), {});
  assert.deepEqual(payerNumberField('mobile', ' +222 36-12 '), { payerNumber: '+2223612' });
  assert.deepEqual(payerNumberField('bank', '٣٦١٢'), { payerNumber: '3612' });
  assert.deepEqual(payerNumberField('mobile', 'MR13'), {}, 'a malformed number never travels: Complete is held on screen instead');
});

it('normalising twice changes nothing (what is stored parses to itself)', () => {
  for (const raw of [' +222 36-12 34 56', '٣٦ ١٢', '0036 12']) {
    const once = parsePayerNumber(raw);
    assert.ok(once.ok && once.value);
    assert.deepEqual(parsePayerNumber(once.value), once);
  }
});

console.log(`payer-number: ${passed} checks passed`);
