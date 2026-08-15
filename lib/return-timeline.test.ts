/**
 * Regression guard for the return workflow stages (UX A8).
 *
 *   node lib/return-timeline.test.ts
 *
 * One rule matters more than the rest and is asserted from several angles:
 * **a reported payout must never read as settled.** Approved means the shop
 * owes it, reported means somebody says they paid it, confirmed means the money
 * actually left. Only the last is done.
 */
import assert from 'node:assert/strict';
import { returnStages, type ReturnStageInput } from './return-timeline.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
};

const base: ReturnStageInput = {
  status: 'pending_investigation',
  custody: 'customer_holds',
  responsibility: 'pending_investigation',
  payout: null,
};

const payout = (status: 'reported_pending_confirmation' | 'confirmed') => ({
  status,
  version: 1,
  netAmountDue: 45000,
  reportedAmount: 45000,
  method: 'cash' as const,
  accountLabel: null,
  transactionReference: null,
  note: null,
  reportedBy: 'Fatimatou',
  reportedAt: '2026-08-15T10:00:00.000Z',
  confirmedBy: status === 'confirmed' ? 'Owner' : null,
  confirmedAt: status === 'confirmed' ? '2026-08-15T12:00:00.000Z' : null,
});

const stage = (input: ReturnStageInput, key: string) => {
  const found = returnStages(input).find((s) => s.key === key);
  assert.ok(found, `expected a "${key}" stage`);
  return found;
};

it('waits on custody while the customer still holds the phone', () => {
  assert.equal(stage(base, 'custody').state, 'current');
  // Nothing can be investigated until the phone is back.
  assert.equal(stage(base, 'investigation').state, 'pending');
});

it('moves to investigation once the shop holds the phone', () => {
  const input = { ...base, custody: 'store_holds' as const };
  assert.equal(stage(input, 'custody').state, 'done');
  assert.equal(stage(input, 'investigation').state, 'current');
});

it('a rejected return ENDS — it does not sit waiting for money', () => {
  const input = { ...base, custody: 'handed_back' as const, status: 'rejected' as const };
  assert.equal(stage(input, 'decision').state, 'rejected');
  // The money stages must not exist at all. Rendering them greyed out would
  // imply the return is still in progress and something is still owed.
  const keys = returnStages(input).map((s) => s.key);
  assert.equal(keys.includes('due'), false);
  assert.equal(keys.includes('reported'), false);
  assert.equal(keys.includes('confirmed'), false);
});

it('approved means the shop OWES it, and nothing has been paid', () => {
  const input = { ...base, custody: 'store_holds' as const, status: 'approved_refund_due' as const };
  assert.equal(stage(input, 'due').state, 'done');
  assert.equal(stage(input, 'reported').state, 'pending');
  assert.equal(stage(input, 'confirmed').state, 'pending');
});

it('a REPORTED payout is never done — the whole point of the distinction', () => {
  const input = {
    ...base,
    custody: 'store_holds' as const,
    status: 'approved_refund_due' as const,
    payout: payout('reported_pending_confirmation'),
  };
  // `current` renders warning-toned; `done` would tick it green and read as
  // "someone paid this", before anyone has agreed the money left.
  assert.equal(stage(input, 'reported').state, 'current');
  assert.notEqual(stage(input, 'reported').state, 'done');
  assert.equal(stage(input, 'confirmed').state, 'pending');
});

it('ONLY confirmation marks the money settled', () => {
  const input = {
    ...base,
    custody: 'store_holds' as const,
    status: 'approved_refund_due' as const,
    payout: payout('confirmed'),
  };
  assert.equal(stage(input, 'reported').state, 'done');
  assert.equal(stage(input, 'confirmed').state, 'done');
  assert.equal(stage(input, 'confirmed').at, '2026-08-15T12:00:00.000Z');
});

it('never shows two stages as the current one at the same time', () => {
  const inputs: ReturnStageInput[] = [
    base,
    { ...base, custody: 'store_holds' },
    { ...base, custody: 'store_holds', status: 'approved_refund_due' },
    {
      ...base,
      custody: 'store_holds',
      status: 'approved_refund_due',
      payout: payout('reported_pending_confirmation'),
    },
    { ...base, custody: 'store_holds', status: 'approved_refund_due', payout: payout('confirmed') },
    { ...base, custody: 'handed_back', status: 'rejected' },
  ];
  for (const input of inputs) {
    const current = returnStages(input).filter((s) => s.state === 'current');
    assert.ok(current.length <= 1, `two current stages for ${JSON.stringify(input.status)}`);
  }
});

it('the liability stays recorded after it is settled', () => {
  const input = {
    ...base,
    custody: 'store_holds' as const,
    status: 'approved_refund_due' as const,
    payout: payout('confirmed'),
  };
  // History should still say the shop owed it, even though it no longer does.
  assert.equal(stage(input, 'due').state, 'done');
});

console.log(`\n${passed} return-timeline checks passed`);
