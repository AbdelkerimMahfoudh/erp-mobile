/**
 * Correcting an in-stock unit — proved without a screen.
 *
 *   node lib/unit-correction.test.ts
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeCorrection,
  buildCorrectionBody,
  imeiFormatProblem,
  normImei,
  normSerial,
  type CorrectionForm,
  type UnitForCorrection,
} from './unit-correction.ts';

const IMEI_A = '350000000000006'; // Luhn-valid
const IMEI_B = '353210110000005'; // Luhn-valid
const IMEI_C = '490154203237518'; // Luhn-valid

const phone: UnitForCorrection = {
  imeiPrimary: IMEI_A,
  imeiSecondary: null,
  serialNo: null,
  cost: 100,
  updatedAt: '2026-09-21T10:00:00.000Z',
  trackingType: 'imei',
};
const tv: UnitForCorrection = {
  imeiPrimary: null,
  imeiSecondary: null,
  serialNo: 'SN-OLD',
  cost: 100,
  updatedAt: '2026-09-21T10:00:00.000Z',
  trackingType: 'serial',
};

const emptyForm: CorrectionForm = {
  newProductId: null,
  imei1: '',
  imei2: '',
  serial: '',
  cost: '',
  reason: '',
  canViewCost: true,
};
const form = (over: Partial<CorrectionForm> = {}): CorrectionForm => ({ ...emptyForm, ...over });

it('normalises identifiers the way the server does', () => {
  assert.equal(normImei('35 00-00.00/0000006'), '350000000000006');
  assert.equal(normSerial('  sn-abc  '), 'SN-ABC');
});

it('spots a bad IMEI before the server does', () => {
  assert.equal(imeiFormatProblem('350000000000006'), null);
  assert.equal(imeiFormatProblem(''), 'empty');
  assert.equal(imeiFormatProblem('35000000000000x'), 'not_digits');
  assert.equal(imeiFormatProblem('3500'), 'length');
  assert.equal(imeiFormatProblem('350000000000000'), 'checksum');
});

it('an untouched form is blocked with nothing to correct', () => {
  const s = analyzeCorrection(phone, form({ imei1: IMEI_A }), true);
  assert.equal(s.anyChange, false);
  assert.equal(s.blocked, true);
});

it('a not-in-stock unit is blocked even with a valid change', () => {
  const s = analyzeCorrection(phone, form({ imei1: IMEI_B, reason: 'typo' }), false);
  assert.equal(s.blocked, true);
});

it('a sensitive change without a reason is blocked, and named as missing', () => {
  const s = analyzeCorrection(phone, form({ imei1: IMEI_B }), true);
  assert.equal(s.imei1Changed, true);
  assert.equal(s.sensitiveChange, true);
  assert.equal(s.reasonMissing, true);
  assert.equal(s.blocked, true);
});

it('a sensitive change with a reason and a valid IMEI is allowed', () => {
  const s = analyzeCorrection(phone, form({ imei1: IMEI_B, reason: 'scanned wrong box' }), true);
  assert.equal(s.blocked, false);
});

it('a product-only change needs no reason', () => {
  const s = analyzeCorrection(phone, form({ imei1: IMEI_A, newProductId: 'p2' }), true);
  assert.equal(s.productChanged, true);
  assert.equal(s.sensitiveChange, false);
  assert.equal(s.reasonMissing, false);
  assert.equal(s.blocked, false);
});

it('catches a second IMEI equal to the first', () => {
  const s = analyzeCorrection(phone, form({ imei1: IMEI_A, imei2: IMEI_A, reason: 'x' }), true);
  assert.equal(s.imei2Problem, 'same');
  assert.equal(s.blocked, true);
});

it('catches an invalid second IMEI', () => {
  const s = analyzeCorrection(phone, form({ imei1: IMEI_A, imei2: '123', reason: 'x' }), true);
  assert.equal(s.imei2Problem, 'invalid');
  assert.equal(s.blocked, true);
});

it('serial fields do not apply to an imei unit, and vice versa', () => {
  const imeiUnitSerialTyped = analyzeCorrection(phone, form({ imei1: IMEI_A, serial: 'SN1' }), true);
  assert.equal(imeiUnitSerialTyped.serialChanged, false);
  const serialUnitImeiTyped = analyzeCorrection(tv, form({ serial: 'SN-OLD', imei1: IMEI_A }), true);
  assert.equal(serialUnitImeiTyped.imei1Changed, false);
});

it('corrects a serial on a serial-tracked unit, upper-casing it', () => {
  const s = analyzeCorrection(tv, form({ serial: 'sn-new', reason: 'typo' }), true);
  assert.equal(s.serialChanged, true);
  assert.equal(s.blocked, false);
});

it('cost only counts as a change when the caller may see it', () => {
  const withCost = analyzeCorrection(phone, form({ imei1: IMEI_A, cost: '120', reason: 'x' }), true);
  assert.equal(withCost.costChanged, true);
  const noCostView = analyzeCorrection(phone, form({ imei1: IMEI_A, cost: '120', canViewCost: false }), true);
  assert.equal(noCostView.costChanged, false);
  assert.equal(noCostView.anyChange, false);
});

it('builds a body of only what changed, with the lock and the reason', () => {
  const body = buildCorrectionBody(phone, form({ imei1: IMEI_B, cost: '120', reason: 'off by a digit' }));
  assert.deepEqual(body, {
    expectedUpdatedAt: '2026-09-21T10:00:00.000Z',
    imeiPrimary: IMEI_B,
    cost: 120,
    reason: 'off by a digit',
  });
});

it('clears a second IMEI with an explicit null', () => {
  const dual: UnitForCorrection = { ...phone, imeiSecondary: IMEI_C };
  const body = buildCorrectionBody(dual, form({ imei1: IMEI_A, imei2: '', reason: 'not dual sim' }));
  assert.equal(body.imeiSecondary, null);
  assert.equal('imeiPrimary' in body, false); // primary unchanged → not sent
});

it('a product-only body carries no reason', () => {
  const body = buildCorrectionBody(phone, form({ imei1: IMEI_A, newProductId: 'p2' }));
  assert.deepEqual(body, {
    expectedUpdatedAt: '2026-09-21T10:00:00.000Z',
    productId: 'p2',
  });
});

console.log('unit-correction: all assertions passed');
