/**
 * What the phone may say about an approval (A2/CP4).
 *
 * Run directly with Node (type-stripping), no test runner:
 *   node lib/discount-approval-state.test.ts
 *
 * The invariant under test throughout: the client reports the server's row and
 * never concludes anything from it. Every "is this usable?" question here is
 * about what to DISPLAY — the server refuses regardless, and these functions
 * exist so the screen does not offer a button that is going to fail.
 */
import assert from 'node:assert/strict';
import {
  approvalFor,
  canCancel,
  canDecide,
  discountPercent,
  hasLapsed,
  isTerminal,
  lossIfBelowCost,
  minutesLeft,
  pendingFor,
  refusalOf,
  viewOf,
  type DiscountApproval,
} from './discount-approval-state.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
};

const NOW = new Date('2026-09-10T12:00:00.000Z');
const inMinutes = (n: number) => new Date(NOW.getTime() + n * 60_000).toISOString();

const row = (over: Partial<DiscountApproval> = {}): DiscountApproval => ({
  id: 'a1',
  status: 'pending',
  unitId: 'u1',
  requesterId: 'r1',
  approverId: null,
  configuredPrice: 17_000,
  requestedPrice: 15_000,
  discountAmount: 2_000,
  approvedPrice: null,
  belowCost: false,
  reason: null,
  decisionNote: null,
  voidReason: null,
  expiresAt: inMinutes(30),
  createdAt: NOW.toISOString(),
  version: 0,
  product: { name: 'Phone', variant: '128 GB' },
  identifier: '123456789012347',
  branchName: 'Main',
  requesterName: 'Fatima',
  approverName: null,
  ...over,
});

console.log('the six states stay six states');

it('terminal states are terminal, and pending and approved are not', () => {
  assert.equal(isTerminal('rejected'), true);
  assert.equal(isTerminal('expired'), true);
  assert.equal(isTerminal('voided'), true);
  assert.equal(isTerminal('consumed'), true);
  assert.equal(isTerminal('pending'), false);
  assert.equal(isTerminal('approved'), false);
});

it('a row past its expiry reads as lapsed even while the server still says pending', () => {
  /*
   * The server expires lazily, on read. A row fetched a minute ago can be past
   * its expiry and still say `pending`; showing it as live would put a
   * countdown at zero beside an Approve button that is going to fail.
   */
  assert.equal(hasLapsed(row({ expiresAt: inMinutes(-1) }), NOW), true);
  assert.equal(viewOf(row({ expiresAt: inMinutes(-1) }), NOW), 'lapsed');
  assert.equal(viewOf(row(), NOW), 'pending');
});

it('a decided row does not lapse — an answer does not expire', () => {
  assert.equal(hasLapsed(row({ status: 'rejected', expiresAt: inMinutes(-60) }), NOW), false);
  assert.equal(viewOf(row({ status: 'rejected', expiresAt: inMinutes(-60) }), NOW), 'rejected');
  assert.equal(viewOf(row({ status: 'consumed', expiresAt: inMinutes(-60) }), NOW), 'consumed');
});

it('minutes left floors, and never goes negative', () => {
  assert.equal(minutesLeft(inMinutes(29.9), NOW), 29);
  assert.equal(minutesLeft(inMinutes(-5), NOW), 0);
});

console.log('who may do what');

it('only the person who asked may withdraw, and only while it is pending', () => {
  assert.equal(canCancel(row(), 'r1', NOW), true);
  assert.equal(canCancel(row(), 'someone-else', NOW), false);
  assert.equal(canCancel(row(), null, NOW), false);
  assert.equal(canCancel(row({ status: 'approved' }), 'r1', NOW), false);
  assert.equal(canCancel(row({ expiresAt: inMinutes(-1) }), 'r1', NOW), false);
});

it('only an approver decides, and only on a live request', () => {
  assert.equal(canDecide(row(), true, NOW), true);
  assert.equal(canDecide(row(), false, NOW), false);
  assert.equal(canDecide(row({ status: 'approved' }), true, NOW), false);
  assert.equal(canDecide(row({ expiresAt: inMinutes(-1) }), true, NOW), false);
});

console.log('matching an approval to a sale line');

it('matches the exact unit at the exact price, and nothing else', () => {
  /*
   * The whole reuse problem in miniature: an approval granted for 15 000 must
   * never be offered to a sale at 1 500. The server enforces exactly this, and
   * the client matches the same way so the two never disagree about which
   * request is being talked about.
   */
  const approved = row({ status: 'approved', approvedPrice: 15_000 });
  assert.equal(approvalFor([approved], 'u1', 15_000, NOW)?.id, 'a1');
  assert.equal(approvalFor([approved], 'u1', 1_500, NOW), null);
  assert.equal(approvalFor([approved], 'another-unit', 15_000, NOW), null);
});

it('does not offer an approval that has lapsed', () => {
  const stale = row({ status: 'approved', approvedPrice: 15_000, expiresAt: inMinutes(-1) });
  assert.equal(approvalFor([stale], 'u1', 15_000, NOW), null);
});

it('tolerates the same amount written with a rounding wobble', () => {
  const approved = row({ status: 'approved', approvedPrice: 15_000 });
  assert.equal(approvalFor([approved], 'u1', 15_000.001, NOW)?.id, 'a1');
});

it('finds a pending request for this exact price, so nobody asks twice', () => {
  assert.equal(pendingFor([row()], 'u1', 15_000, NOW)?.id, 'a1');
  assert.equal(pendingFor([row()], 'u1', 14_000, NOW), null);
});

console.log('what may be shown about money');

it('states the discount as a percentage of the set price', () => {
  // Safe in front of anybody: a proportion of the shop's own price reveals
  // nothing about what the shop paid.
  assert.equal(discountPercent({ configuredPrice: 20_000, requestedPrice: 15_000 }), 25);
});

it('does not divide by a zero set price', () => {
  assert.equal(discountPercent({ configuredPrice: 0, requestedPrice: 0 }), null);
});

it('reports a loss only when the cost actually arrived', () => {
  /*
   * `unitCost` is absent for a caller without `cost.view` — the gate strips it.
   * An absent cost is the gate working, not an error, and the app must not
   * estimate the missing figure from anything.
   */
  assert.equal(lossIfBelowCost(row({ belowCost: true, requestedPrice: 9_000 })), null);
  assert.equal(
    lossIfBelowCost(row({ belowCost: true, requestedPrice: 9_000, unitCost: 10_000 })),
    1_000,
  );
});

it('reports no loss when the sale is above cost', () => {
  assert.equal(lossIfBelowCost(row({ belowCost: false, unitCost: 10_000 })), null);
});

it('measures the loss against the APPROVED price, not the one that was asked for', () => {
  // The sale uses the approved price. A loss quoted from the request would be
  // a figure about a sale that is not going to happen.
  assert.equal(
    lossIfBelowCost(
      row({ belowCost: true, requestedPrice: 5_000, approvedPrice: 9_000, unitCost: 10_000 }),
    ),
    1_000,
  );
});

console.log('refusals are codes, never sentences');

it('recognises every code the sale flow acts on', () => {
  for (const code of [
    'approval_required',
    'approval_price_changed',
    'approval_expired',
    'approval_already_used',
    'approval_unit_sold',
    'approval_unit_transferred',
    'approval_cost_changed',
    'acknowledgement_rejected',
  ]) {
    assert.equal(refusalOf(code), code);
  }
});

it('treats anything else as unknown rather than guessing', () => {
  /*
   * The app runs in three languages. Matching an English sentence works in
   * exactly one of them, so an unrecognised refusal falls through to the
   * server's own message rather than to a branch chosen by a regex.
   */
  assert.equal(refusalOf('something_new'), 'unknown');
  assert.equal(refusalOf(undefined), 'unknown');
});

console.log(`\n${passed} passed`);
