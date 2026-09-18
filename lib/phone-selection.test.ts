/**
 * Three ways to find the phone, one selection: scan, typed IMEI and the shelf
 * all end in the same server lookup and the same payment flow, and none of
 * them creates stock.
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  availabilityKey,
  lookupFailure,
  manualImeiProblem,
  normalizeImeiInput,
  sourceKey,
} from './phone-selection-rules';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const QUICK_SELL = read('app/quick-sell.tsx');
const PICKER = read('components/sell/PhonePicker.tsx');
const LIB = read('lib/phone-selection.ts');

it('typed IMEI: only presentation characters are removed', () => {
  assert.equal(normalizeImeiInput(' 49 0154-2032.37518 '), '490154203237518');
});

it('typed IMEI: empty, letters, length and checksum each have their own message', () => {
  assert.equal(manualImeiProblem(''), 'empty');
  assert.equal(manualImeiProblem('49015420323751O'), 'not_digits');
  assert.equal(manualImeiProblem('49015420323751'), 'length');
  assert.equal(manualImeiProblem('490154203237519'), 'checksum');
  assert.equal(manualImeiProblem('490154203237518'), null);
});

it('lookup failures map to plain outcomes, network apart', () => {
  assert.equal(lookupFailure(400, 'imei_checksum'), 'invalid');
  assert.equal(lookupFailure(404), 'not_found');
  assert.equal(lookupFailure(404, 'not_available_here'), 'not_here');
  assert.equal(lookupFailure(403), 'forbidden');
  assert.equal(lookupFailure(0), 'network');
  assert.equal(lookupFailure(500), 'server');
});

it('every availability and source has words', () => {
  for (const a of ['available', 'sold', 'faulty', 'reserved', 'other_branch', 'unavailable'] as const) {
    assert.equal(availabilityKey(a), `pick.availability.${a}`);
  }
  for (const s of ['scan', 'manual', 'stock'] as const) assert.equal(sourceKey(s), `pick.source.${s}`);
});

it('all three ways end in the one server lookup and one choose()', () => {
  assert.ok(LIB.includes('/sales/selection/'));
  assert.ok(QUICK_SELL.includes("findAndChoose(result.code, 'scan')"));
  assert.ok(QUICK_SELL.includes('<ManualImeiPanel'));
  assert.ok(QUICK_SELL.includes('<StockPicker'));
  assert.ok(PICKER.includes('lookupSelection('));
});

it('the scanner is reused, and payment is the existing sheet', () => {
  assert.ok(QUICK_SELL.includes('ScanTarget'));
  assert.ok(QUICK_SELL.includes('PaymentSheet'));
  assert.ok(QUICK_SELL.includes("t('pick.continue')"));
});

it('finding a phone never creates stock or writes a barcode', () => {
  for (const src of [QUICK_SELL, PICKER, LIB]) {
    assert.doesNotMatch(src, /\bpost\(\s*['`]\/(units|products|inventory)/);
    assert.doesNotMatch(src, /barcode\s*:/);
  }
});

it('EN, FR and AR carry every pick key', () => {
  const keys = (read('lib/i18n/en.ts').match(/'pick\.[^']+'/g) ?? []);
  assert.ok(keys.length >= 40);
  for (const lang of ['fr', 'ar']) {
    const src = read(`lib/i18n/${lang}.ts`);
    for (const k of keys) assert.ok(src.includes(`${k}:`), `${lang} lacks ${k}`);
  }
});

it('the picker uses tokens, not raw colours', () => {
  assert.doesNotMatch(PICKER, /#[0-9a-fA-F]{3,6}\b/);
});

it('another branch is named only when the server sent it', () => {
  // The app never infers another branch: it shows a name only when the server
  // (branch.manage) included one, and otherwise the server's generic answer.
  assert.ok(PICKER.includes('selection.otherBranch'));
  assert.doesNotMatch(PICKER + QUICK_SELL, /usePermission('branch.manage')/);
  assert.ok(read('lib/i18n/en.ts').includes("'pick.failure.not_here': \"This phone is not available in this branch.\""));
});
