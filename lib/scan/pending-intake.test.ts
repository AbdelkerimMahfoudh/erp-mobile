/**
 * The scan that survives the Create-product detour (milestone O).
 *
 * Run directly with Node (type-stripping):
 *   node lib/scan/pending-intake.test.ts
 * Exits non-zero on any failure.
 */
import assert from 'node:assert/strict';
import {
  clearPendingIntake,
  notePendingProduct,
  holdPendingIntake,
  peekPendingIntake,
  pendingFrom,
  takePendingIntake,
  type IntakeScope,
} from './pending-intake.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  clearPendingIntake();
  fn();
  passed++;
  console.log('  ok  ' + name);
};

const IMEI_A = '490154203237518';
const IMEI_B = '356938035643809';

const SCOPE: IntakeScope = { companyId: 'c1', userId: 'u1', branchId: 'b1' };

it('an accepted IMEI is kept, and comes back after the detour', () => {
  holdPendingIntake(pendingFrom(SCOPE, { imei: { primary: IMEI_A, secondary: null } }));
  const back = takePendingIntake(SCOPE);
  assert.equal(back?.primaryImei, IMEI_A);
  assert.equal(back?.secondaryImei, null);
});

it('both identifiers survive together', () => {
  holdPendingIntake(pendingFrom(SCOPE, { imei: { primary: IMEI_A, secondary: IMEI_B } }));
  const back = takePendingIntake(SCOPE);
  assert.equal(back?.primaryImei, IMEI_A);
  assert.equal(back?.secondaryImei, IMEI_B);
});

it('an IMEI NEVER lands in the product barcode field', () => {
  // The whole point. The lost-state defect must not be "fixed" by copying the
  // identifier into the box that happens to survive navigation.
  const pending = pendingFrom(SCOPE, { imei: { primary: IMEI_A, secondary: IMEI_B } });
  assert.equal(pending.productBarcode, null);
});

it('a genuine product barcode is carried into product creation', () => {
  const pending = pendingFrom(SCOPE, { productBarcode: '5901234123457' });
  assert.equal(pending.productBarcode, '5901234123457');
  assert.equal(pending.primaryImei, null, 'and it is not mistaken for a phone');
});

it('safe draft fields come back too; nothing else is stored', () => {
  const pending = pendingFrom(SCOPE, { imei: { primary: IMEI_A, secondary: null }, cost: '4500' });
  assert.equal(pending.cost, '4500');
  // No frame, no image, no path — a draft is a form's inputs, never a file.
  assert.deepEqual(
    Object.keys(pending).sort(),
    ['at', 'cost', 'createdProductId', 'primaryImei', 'productBarcode', 'scope', 'secondaryImei', 'serial'],
  );
});

it('cancelling product creation leaves the scan intact', () => {
  holdPendingIntake(pendingFrom(SCOPE, { imei: { primary: IMEI_A, secondary: null } }));
  // Peeking is what a cancelled detour does: come back and find it still there.
  assert.equal(peekPendingIntake(SCOPE)?.primaryImei, IMEI_A);
  assert.equal(peekPendingIntake(SCOPE)?.primaryImei, IMEI_A, 'peeking does not consume it');
});

it('taking it consumes it, so one scan cannot become two units', () => {
  holdPendingIntake(pendingFrom(SCOPE, { imei: { primary: IMEI_A, secondary: null } }));
  assert.ok(takePendingIntake(SCOPE));
  assert.equal(takePendingIntake(SCOPE), null);
});

// ── isolation ────────────────────────────────────────────────────────────────

it('another user in the same company cannot see the scan', () => {
  holdPendingIntake(pendingFrom(SCOPE, { imei: { primary: IMEI_A, secondary: null } }));
  assert.equal(takePendingIntake({ ...SCOPE, userId: 'u2' }), null);
});

it('another company cannot see it', () => {
  holdPendingIntake(pendingFrom(SCOPE, { imei: { primary: IMEI_A, secondary: null } }));
  assert.equal(takePendingIntake({ ...SCOPE, companyId: 'c2' }), null);
});

it('switching branch mid-detour does not carry the scan across', () => {
  // Receiving is branch-scoped: a phone accepted at one shop must not appear in
  // another shop's intake because somebody switched branch on the way back.
  holdPendingIntake(pendingFrom(SCOPE, { imei: { primary: IMEI_A, secondary: null } }));
  assert.equal(takePendingIntake({ ...SCOPE, branchId: 'b2' }), null);
});

it('a rejected read is never held in the first place', () => {
  const pending = pendingFrom(SCOPE, {});
  assert.equal(pending.primaryImei, null);
  assert.equal(pending.productBarcode, null);
});

it('the newly created product is remembered, and creating it makes no unit', () => {
  holdPendingIntake(pendingFrom(SCOPE, { imei: { primary: IMEI_A, secondary: null } }));
  notePendingProduct('p-new');
  const back = takePendingIntake(SCOPE);
  assert.equal(back?.createdProductId, 'p-new');
  // Creating a Product does not create the Unit: the IMEI is still waiting to
  // become one when the intake is submitted.
  assert.equal(back?.primaryImei, IMEI_A);
});

it('a serial number survives the detour, for a TV or a laptop', () => {
  holdPendingIntake(pendingFrom(SCOPE, { serial: 'BRV-B-2033266574' }));
  const back = takePendingIntake(SCOPE);
  assert.equal(back?.serial, 'BRV-B-2033266574');
  assert.equal(back?.primaryImei, null, 'a serial is not a phone');
  assert.equal(back?.productBarcode, null, 'and never a product barcode');
});

it('cancelling product creation keeps the serial too', () => {
  holdPendingIntake(pendingFrom(SCOPE, { serial: 'LGSN-A-844113836' }));
  // Cancel = the form closes without notePendingProduct.
  assert.equal(peekPendingIntake(SCOPE)?.serial, 'LGSN-A-844113836');
  assert.equal(takePendingIntake(SCOPE)?.createdProductId, null);
});

it('a created product comes back with its serial still waiting to become a unit', () => {
  holdPendingIntake(pendingFrom(SCOPE, { serial: 'LGSN-A-844113836' }));
  notePendingProduct('p-tv');
  const back = takePendingIntake(SCOPE);
  assert.equal(back?.createdProductId, 'p-tv');
  assert.equal(back?.serial, 'LGSN-A-844113836');
});

it('an IMEI scan never also records a serial', () => {
  const pending = pendingFrom(SCOPE, { imei: { primary: IMEI_A, secondary: null }, serial: 'X' });
  assert.equal(pending.serial, null);
});

console.log('\n' + passed + ' passed');
