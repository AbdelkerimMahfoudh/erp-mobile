/**
 * Submitting one sale — the rules, proved without a screen.
 *
 *   node lib/sale-submission.test.ts
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  classifySubmitFailure,
  maySubmit,
  quantityProblem,
  resolveUncertain,
  saleLineFor,
  saleTotal,
} from './sale-submission.ts';
import type { SaleSelection } from '../types/api';

const product = (over: Partial<SaleSelection['product']> = {}): SaleSelection['product'] => ({
  brand: 'Anker', model: 'Cable', variant: null, storage: null, colour: null, trackingType: 'quantity', ...over,
});
const unitSel: SaleSelection = {
  kind: 'unit', unitId: 'u1', availability: 'available', status: 'in_stock', matchedBy: 'serial',
  identifierMasked: '•••• 0019', hasSecondImei: false, product: product({ trackingType: 'serial', brand: 'Canon', model: 'EOS R50' }),
  price: 899, otherBranch: null,
};
const productSel: SaleSelection = {
  kind: 'product', unitId: null, productId: 'p1', availability: 'available', status: 'in_stock', matchedBy: 'barcode',
  identifierMasked: '6901234567890', hasSecondImei: false, product: product(), price: 9, otherBranch: null, quantityAvailable: 60,
};

it('a serialized unit is sold by the identifier it was found by — an IMEI or a serial, never invented', () => {
  assert.deepEqual(saleLineFor(unitSel, 'CAN-1662030-0019', 1, 899), { identifier: 'CAN-1662030-0019', price: 899 });
  assert.deepEqual(saleLineFor({ ...unitSel, matchedBy: 'imei2' }, '490154203237518', 3, 899), { identifier: '490154203237518', price: 899 });
});

it('a counted product is sold by product id and quantity — no unit, no serial, no IMEI', () => {
  const line = saleLineFor(productSel, '6901234567890', 3, 9);
  assert.deepEqual(line, { productId: 'p1', quantity: 3, price: 9 });
  assert.ok(!('identifier' in line));
});

it('a quantity must be a whole number, at least one, and no more than the branch has', () => {
  assert.equal(quantityProblem(1, 60), null);
  assert.equal(quantityProblem(60, 60), null);
  assert.equal(quantityProblem(0, 60), 'too_few');
  assert.equal(quantityProblem(-2, 60), 'too_few');
  assert.equal(quantityProblem(1.5, 60), 'not_whole');
  assert.equal(quantityProblem(61, 60), 'too_many');
  assert.equal(quantityProblem(5, undefined), null); // a unit has no quantity to exceed
});

it('the payment sheet opens on price × quantity, rounded to cents', () => {
  assert.equal(saleTotal(9, 3), 27);
  assert.equal(saleTotal(0.1, 3), 0.3);
  assert.equal(saleTotal(899, 1), 899);
});

it('a timeout is UNCERTAIN, never "not sent"', () => {
  assert.deepEqual(classifySubmitFailure({ name: 'RequestTimeout', message: 'x' }), { kind: 'uncertain' });
  assert.deepEqual(classifySubmitFailure({ name: 'AbortError', message: 'x' }), { kind: 'uncertain' });
});

it('the server naming the failure is passed through by name', () => {
  assert.deepEqual(classifySubmitFailure({ status: 409, code: 'idempotency_conflict', message: 'm' }), { kind: 'idempotency_conflict' });
  assert.deepEqual(classifySubmitFailure({ status: 403, code: 'approval_required', message: 'm' }), { kind: 'approval_required' });
  assert.deepEqual(classifySubmitFailure({ status: 409, body: { code: 'idempotency_conflict' }, message: 'm' }), { kind: 'idempotency_conflict' });
  assert.deepEqual(classifySubmitFailure({ status: 409, message: 'That item was taken while you were selling' }), {
    kind: 'refused', status: 409, message: 'That item was taken while you were selling', code: null,
  });
  assert.deepEqual(classifySubmitFailure({ status: 500, message: 'boom' }), { kind: 'failed', message: 'boom' });
});

it('an unreachable server is offline, not a failure that was recorded', () => {
  assert.deepEqual(classifySubmitFailure(new TypeError('Failed to fetch')), { kind: 'offline' });
  assert.deepEqual(classifySubmitFailure(new Error('weird')), { kind: 'failed', message: 'weird' });
});

it('after uncertainty, the key is asked about: found finishes, 404 may resend the same key, silence holds', () => {
  assert.deepEqual(resolveUncertain(null), { kind: 'found' });
  assert.deepEqual(resolveUncertain({ status: 404 }), { kind: 'not_found' });
  assert.deepEqual(resolveUncertain({ name: 'RequestTimeout' }), { kind: 'unreachable' });
  assert.deepEqual(resolveUncertain(new TypeError('net')), { kind: 'unreachable' });
});

it('a second tap while one is in flight never starts another submission', () => {
  const base = { inFlight: false, sellable: true, price: 899, quantity: 1, available: undefined };
  assert.equal(maySubmit(base), true);
  assert.equal(maySubmit({ ...base, inFlight: true }), false);
  assert.equal(maySubmit({ ...base, sellable: false }), false);
  assert.equal(maySubmit({ ...base, price: null }), false);
  assert.equal(maySubmit({ ...base, price: 0 }), false);
  assert.equal(maySubmit({ ...base, quantity: 0 }), false);
  assert.equal(maySubmit({ ...base, quantity: 3, available: 2 }), false);
});

// ── The two checkouts follow the rules above, not their own ──────────────────

const read = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const SCREENS = { 'app/quick-sell.tsx': read('app/quick-sell.tsx'), 'app/(tabs)/sell.tsx': read('app/(tabs)/sell.tsx') };

it('both checkouts name a failure before reporting it, and ask the server about a lost answer', () => {
  for (const [file, src] of Object.entries(SCREENS)) {
    assert.ok(src.includes('classifySubmitFailure(error)'), `${file} classifies`);
    assert.ok(src.includes('recoverUncertainSale<SaleResponse>(clientUuid.current)'), `${file} asks what the key recorded`);
    assert.ok(src.includes('refreshAfterUncertainty(qc, branchId)'), `${file} re-reads what a sale moves`);
    // A lost answer never says "not sent" through the generic error toast.
    const uncertain = src.slice(src.indexOf("case 'uncertain'"), src.indexOf("case 'idempotency_conflict'"));
    assert.doesNotMatch(uncertain, /toErrorMessage/);
    assert.ok(uncertain.includes("t('sell.submit.notRecorded')") && uncertain.includes("t('sell.submit.unknown')"));
  }
});

it('the key is rotated only for a new sale or a key the server already spent — never after a timeout', () => {
  for (const [file, src] of Object.entries(SCREENS)) {
    const rotations = src.split('clientUuid.current = uuidv4()').length - 1;
    assert.equal(rotations, 2, `${file}: one rotation for a new sale, one for a conflict`);
    const uncertain = src.slice(src.indexOf("case 'uncertain'"), src.indexOf("case 'idempotency_conflict'"));
    assert.doesNotMatch(uncertain, /uuidv4\(\)/);
  }
});

it('loading is released on every path, and a second tap finds the first still in flight', () => {
  for (const [file, src] of Object.entries(SCREENS)) {
    assert.ok(src.includes('if (!payments || inFlight.current) return;'), `${file}: the approval path is guarded`);
    const releases = src.match(/finally \{\s*inFlight\.current = false;\s*setSubmitting\(false\);/g) ?? [];
    assert.equal(releases.length, 2, `${file}: complete and approved both release in finally`);
  }
  assert.ok(SCREENS['app/quick-sell.tsx'].includes('if (!maySubmit({ inFlight: inFlight.current'));
  assert.ok(SCREENS['app/(tabs)/sell.tsx'].includes('if (inFlight.current) return;'));
});

it('a counted product is sold how many was chosen, at price × quantity, within what the branch has', () => {
  const src = SCREENS['app/quick-sell.tsx'];
  assert.ok(src.includes('saleLineFor(picked.selection, identifier, quantity, proposedPrice)'));
  assert.ok(src.includes('saleTotal(proposedPrice, quantity)'));
  assert.ok(src.includes('quantityProblem(quantity, available)'));
  assert.ok(src.includes('max={available ?? 9999}'));
  assert.ok(src.includes('quantityIssue !== null'), 'Continue is disabled while the quantity is wrong');
});

console.log('sale-submission: all assertions passed');
