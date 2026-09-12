/**
 * What a scan suggests, and where a scanned code is allowed to land.
 *
 *   node lib/scan/suggested-tracking.test.ts
 */
import assert from 'node:assert/strict';
import { fieldForScan, suggestedTracking, type ScanKind } from './suggested-tracking.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log('  ok  ' + name);
};

const ALL: ScanKind[] = ['imei', 'serial', 'barcode', 'quantity', 'unknown'];

it('an IMEI suggests IMEI tracking', () => {
  assert.equal(suggestedTracking('imei'), 'imei');
});

it('a serial suggests SERIAL tracking, never IMEI', () => {
  assert.equal(suggestedTracking('serial'), 'serial');
  assert.notEqual(suggestedTracking('serial'), 'imei', 'a television has no IMEI to ask for');
});

it('a numeric serial is still a serial: digits are not an IMEI', () => {
  /*
   * The scanner decides this, not the shape of the string — an IMEI is 15
   * digits that pass Luhn, and "2033266574" is neither. This suite pins the
   * consequence: the only input here is the classification, so nothing
   * downstream can re-derive "looks numeric, must be an IMEI".
   */
  assert.equal(suggestedTracking('serial'), 'serial');
});

it('a product barcode suggests nothing about tracking', () => {
  assert.equal(suggestedTracking('barcode'), null, 'an EAN names a model, not a unit');
});

it('an unrecognised code suggests nothing', () => {
  assert.equal(suggestedTracking('unknown'), null);
  assert.equal(suggestedTracking('quantity'), null);
});

it('every scan kind has an answer, and a suggestion is only ever a real mode', () => {
  for (const kind of ALL) {
    const s = suggestedTracking(kind);
    assert.ok(s === null || ['imei', 'serial', 'quantity'].includes(s), kind);
  }
});

// ── the four identifier fields never cross-populate ─────────────────────────

it('an IMEI goes to the IMEI field and nowhere else', () => {
  assert.equal(fieldForScan('imei'), 'imei');
  assert.notEqual(fieldForScan('imei'), 'productBarcode', 'an IMEI in the product barcode poisons recognition');
  assert.notEqual(fieldForScan('imei'), 'serial');
});

it('a serial goes to the serial field and nowhere else', () => {
  assert.equal(fieldForScan('serial'), 'serial');
  assert.notEqual(fieldForScan('serial'), 'imei');
  assert.notEqual(fieldForScan('serial'), 'productBarcode');
});

it('a product barcode goes to the product barcode field and nowhere else', () => {
  assert.equal(fieldForScan('barcode'), 'productBarcode');
  assert.notEqual(fieldForScan('barcode'), 'serial', 'a model code is not the item in your hand');
  assert.notEqual(fieldForScan('barcode'), 'imei');
});

it('nothing is placed for a code the scanner could not classify', () => {
  assert.equal(fieldForScan('unknown'), null);
  assert.equal(fieldForScan('quantity'), null);
});

it('each field is claimed by exactly one kind', () => {
  const placed = ALL.map(fieldForScan).filter((f): f is NonNullable<typeof f> => f !== null);
  assert.equal(new Set(placed).size, placed.length, 'two kinds must never target the same field');
});

console.log('\n' + passed + ' passed');
