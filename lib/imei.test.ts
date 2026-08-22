/**
 * Reading an IMEI off a phone screen (Milestone C).
 *
 *   node lib/imei.test.ts
 *
 * The rule these exist to protect: **never silently accept a guessed digit.**
 * A failed read costs seconds. A wrong IMEI is a phone that cannot be found,
 * sold, returned or warranty-matched for the rest of its life.
 */
import assert from 'node:assert/strict';
import {
  extractImeis,
  isValidImei,
  isValidLuhn,
  readDualSim,
  tacOf,
} from './imei.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
};

// Real-shaped, Luhn-valid IMEIs.
const A = '356938035643809';
const B = '490154203237518';

it('the fixtures are genuinely Luhn-valid, or nothing below means anything', () => {
  assert.equal(isValidLuhn(A), true);
  assert.equal(isValidLuhn(B), true);
});

it('accepts a valid IMEI and rejects a bad check digit', () => {
  assert.equal(isValidImei(A), true);
  // Last digit changed: this is what a single misread looks like.
  assert.equal(isValidImei('356938035643808'), false);
});

it('rejects anything that is not exactly fifteen digits', () => {
  assert.equal(isValidImei('35693803564380'), false);
  assert.equal(isValidImei('3569380356438099'), false);
  assert.equal(isValidImei('35693803564380X'), false);
});

it('reads the TAC, which is the first eight digits', () => {
  assert.equal(tacOf(A), '35693803');
  assert.equal(tacOf('nonsense'), null);
});

it('reads a spaced IMEI, because that is how screens print them', () => {
  const [c] = extractImeis('IMEI: 35 693803 564380 9');
  assert.equal(c.imei, A);
  assert.equal(c.source, 'exact');
  assert.deepEqual(c.substitutions, []);
});

it('reads one broken up by dashes and dots too', () => {
  assert.equal(extractImeis('IMEI 35-693803.564380-9')[0].imei, A);
});

it('reads Arabic-Indic digits, which an Arabic device prints', () => {
  const arabic = A.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));
  assert.equal(extractImeis(`IMEI: ${arabic}`)[0].imei, A);
});

/**
 * The safety property, stated three ways. OCR confusions are systematic, so a
 * substitution is only ever offered when the result still satisfies Luhn — and
 * even then it is labelled and listed for a human to agree to.
 */
it('resolves an OCR digit confusion ONLY when Luhn still passes', () => {
  // O for 0, twice.
  const withOs = A.replace(/0/g, 'O');
  const [c] = extractImeis(`IMEI: ${withOs}`);
  assert.equal(c.imei, A);
  assert.equal(c.source, 'ambiguity_resolved');
  assert.ok(c.substitutions.includes('O→0'));
});

it('DISCARDS a substitution that produces an invalid IMEI', () => {
  // S→5 would give a 15-digit number, but one that fails Luhn.
  assert.deepEqual(extractImeis('IMEI: S56938035643809'), []);
});

it('discards a run containing a character that is not even ambiguous', () => {
  assert.deepEqual(extractImeis('IMEI: 3569380356438#9'), []);
});

it('never returns a candidate that fails Luhn, whatever the input', () => {
  for (const text of [
    'IMEI: 356938035643808',
    'IMEI: 000000000000000',
    'IMEI: 123456789012345',
    'SN: ABCDEFGHIJKLMNO',
  ]) {
    for (const c of extractImeis(text)) assert.equal(isValidImei(c.imei), true, text);
  }
});

it('finds both IMEIs on a dual-SIM screen, and labels them', () => {
  const found = extractImeis(`IMEI1: ${A}\nIMEI2: ${B}`);
  assert.equal(found.length, 2);
  assert.equal(found[0].label, 'imei1');
  assert.equal(found[1].label, 'imei2');
});

/**
 * The rule that prevents a phantom device. Two identifiers on one screen are
 * ONE phone — creating two would put an IMEI in inventory that is physically
 * written on the back of a different record.
 */
it('treats two IMEIs as ONE phone with two identifiers', () => {
  const r = readDualSim(extractImeis(`IMEI1: ${A}\nIMEI2: ${B}`));
  assert.equal(r?.primary, A);
  assert.equal(r?.secondary, B);
  assert.equal(r?.ambiguous, false);
});

it('a single-SIM screen yields one identifier and no phantom second', () => {
  const r = readDualSim(extractImeis(`IMEI: ${A}`));
  assert.equal(r?.primary, A);
  assert.equal(r?.secondary, null);
});

it('flags three or more as ambiguous rather than picking two', () => {
  // A screen this code does not understand. Guessing would invent data.
  const C = '013971007194563';
  assert.equal(isValidLuhn(C), true);
  const r = readDualSim(extractImeis(`IMEI1: ${A}\nIMEI2: ${B}\nIMEI: ${C}`));
  assert.equal(r?.ambiguous, true);
});

it('ignores a serial number sitting beside the IMEIs', () => {
  const found = extractImeis(`IMEI: ${A}\nSerial: RF8N32ABCDE\nMEID: 99000812345678`);
  assert.equal(found.length, 1);
  assert.equal(found[0].imei, A);
});

it('deduplicates the same IMEI printed twice on one screen', () => {
  assert.equal(extractImeis(`IMEI: ${A}\nIMEI: ${A}`).length, 1);
});

it('handles empty and junk input without throwing', () => {
  assert.deepEqual(extractImeis(''), []);
  assert.deepEqual(extractImeis('no numbers here at all'), []);
  assert.deepEqual(readDualSim([]), null);
});

console.log(`\n${passed} imei checks passed`);
