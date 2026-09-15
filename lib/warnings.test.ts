/**
 * Rendering a server warning, and the signature that makes offline replay safe.
 *
 * Run directly with Node (type-stripping), no test runner:
 *   node lib/warnings.test.ts
 *
 * The signature test is the important one. The server refuses a confirmation
 * whose warning set no longer matches, and it computes that fingerprint over
 * code, field, severity and parameters. If this module's idea of "the same
 * warning" ever drifts from the server's, a queued sale would either be
 * paused for no reason or, far worse, sent with a confirmation that covers a
 * different question than the one the person answered.
 */
import assert from 'node:assert/strict';
import {
  isWarningsPending,
  needsConfirmation,
  orderWarnings,
  referenceKey,
  warningSignature,
  type ServerWarning,
} from './warnings.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
};

const warning = (over: Partial<ServerWarning> = {}): ServerWarning => ({
  code: 'magnitude.sale_price',
  severity: 'caution',
  messageKey: 'warning.magnitude.salePrice.high',
  params: { factor: 10, direction: 'high' },
  field: 'lines.0.price',
  submitted: 170_000,
  reference: { kind: 'configured_price', amount: 17_000, sample: null },
  ...over,
});

console.log('branching on one field');

it('recognises a warned response', () => {
  assert.equal(
    isWarningsPending({ status: 'warnings_pending', warnings: [], acknowledgementToken: 't', expiresAt: '' }),
    true,
  );
});

it('does not mistake a completed sale for a question', () => {
  assert.equal(isWarningsPending({ id: 's1', invoiceNo: 'INV-1' }), false);
  assert.equal(isWarningsPending(null), false);
  assert.equal(isWarningsPending('warnings_pending'), false);
});

console.log('what the reader is shown');

it('names the reference so each language can phrase the comparison itself', () => {
  assert.equal(referenceKey(warning().reference), 'warning.reference.configuredPrice');
  assert.equal(
    referenceKey({ kind: 'median_sale_price', amount: 17_000, sample: 12 }),
    'warning.reference.medianSalePrice',
  );
});

it('describes a withheld cost instead of quoting it', () => {
  /*
   * The server withholds the figure from a reader without `cost.view`. Naming
   * the KIND is still safe, and it is what makes "compared with what we paid"
   * sayable without ever saying what we paid.
   */
  assert.equal(
    referenceKey({ kind: 'unit_cost', amount: null, sample: null }),
    'warning.reference.unitCost.hidden',
  );
  assert.equal(
    referenceKey({ kind: 'weighted_average_cost', amount: null, sample: 4 }),
    'warning.reference.weightedAverageCost.hidden',
  );
});

it('says nothing about a non-cost reference with no figure', () => {
  // Only cost-derived references are ever withheld. Any other kind arriving
  // without an amount has nothing to say, so it says nothing rather than
  // building a sentence around a missing number.
  assert.equal(referenceKey({ kind: 'configured_price', amount: null, sample: null }), null);
  assert.equal(referenceKey(null), null);
});

it('puts what must be answered above what is merely noted', () => {
  const ordered = orderWarnings([
    warning({ code: 'anomaly.stale_stock', severity: 'info' }),
    warning({ severity: 'caution' }),
  ]);
  assert.equal(ordered[0].severity, 'caution');
});

it('knows when nothing needs a deliberate answer', () => {
  assert.equal(needsConfirmation([warning({ severity: 'info' })]), false);
  assert.equal(needsConfirmation([warning()]), true);
  assert.equal(needsConfirmation([]), false);
});

console.log('the signature the server agrees with');

it('binds code, field, severity and parameters', () => {
  assert.equal(
    warningSignature([warning()]),
    'magnitude.sale_price@lines.0.price#caution~direction=high,factor=10',
  );
});

it('separates the same code saying two different things', () => {
  /*
   * Ten times too HIGH and ten times too LOW are not interchangeable, and a
   * confirmation for one must not silently cover the other. This is the exact
   * safeguard the server added in `483cab9`.
   */
  const high = warningSignature([warning()]);
  const low = warningSignature([
    warning({ messageKey: 'warning.magnitude.salePrice.low', params: { factor: 10, direction: 'low' } }),
  ]);
  assert.notEqual(high, low);
});

it('does not depend on the order the warnings arrived in', () => {
  const a = warning();
  const b = warning({ field: 'lines.1.price' });
  assert.equal(warningSignature([a, b]), warningSignature([b, a]));
});

it('ignores a reference that drifted, because the parameters are buckets', () => {
  /*
   * The server deliberately excludes the reference from its fingerprint: a
   * median moving by one unit is the same warning about the same thing, and
   * re-asking for that would train people to tap through. This module must
   * agree, or it would pause a queued sale for a change the server accepts.
   */
  const before = warningSignature([warning()]);
  const after = warningSignature([
    warning({ reference: { kind: 'configured_price', amount: 17_050, sample: null } }),
  ]);
  assert.equal(before, after);
});

it('treats a warning about the whole request as fieldless, not as an empty field', () => {
  assert.match(warningSignature([warning({ field: null })]), /@-#/);
});

console.log(`\n${passed} passed`);
