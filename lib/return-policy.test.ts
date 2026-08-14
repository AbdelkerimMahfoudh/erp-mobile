/**
 * Regression guard for how the return policy is SAID (I1).
 *
 * Run directly with Node (type-stripping), no test runner or new dependency:
 *   node lib/return-policy.test.ts
 * Exits non-zero on any failure.
 *
 * What is guarded here is wording and offering, never deciding. The server owns
 * eligibility; if any of this started computing it from the phone's clock, a
 * customer could be shown a promise the shop will not honour.
 */
import assert from 'node:assert/strict';
import {
  allowedWindowChoices,
  describeWindow,
  policyStatus,
  receiptPolicyLine,
  type ReturnPolicyView,
  type Translate,
} from './return-policy.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
};

/** A stand-in catalogue: the key and its values, so interpolation is visible. */
const t = ((key: string, values?: Record<string, string | number>) =>
  values ? `${key}(${Object.entries(values).map(([k, v]) => `${k}=${v}`).join(',')})` : key) as unknown as Translate;

const formatDateTime = (d: Date) => d.toISOString();

const view = (over: Partial<ReturnPolicyView> = {}): ReturnPolicyView => ({
  windowHours: 48,
  deadlineAt: '2026-08-16T10:00:00.000Z',
  eligible: true,
  reason: 'within_window',
  remainingMs: 3_600_000,
  requiresOwnerException: false,
  ...over,
});

console.log('describing a window');
it('says days when the window divides into days', () => {
  assert.equal(describeWindow(24, t), 'returns.window.oneDay');
  assert.equal(describeWindow(48, t), 'returns.window.days(count=2)');
  assert.equal(describeWindow(168, t), 'returns.window.days(count=7)');
});

it('falls back to hours when it does not', () => {
  assert.equal(describeWindow(1, t), 'returns.window.oneHour');
  assert.equal(describeWindow(36, t), 'returns.window.hours(count=36)');
});

it('says "no returns" for zero, not "0 hours"', () => {
  assert.equal(describeWindow(0, t), 'returns.window.none');
});

console.log('the receipt line');
it('states both the window and the deadline', () => {
  const line = receiptPolicyLine({ windowHours: 48, deadlineAt: '2026-08-16T10:00:00.000Z' }, t, formatDateTime);
  // "48 hours" alone leaves the customer doing arithmetic from a time they may
  // not remember; the date is what settles the argument at the counter.
  assert.match(line, /window=returns\.window\.days\(count=2\)/);
  assert.match(line, /deadline=2026-08-16T10:00:00\.000Z/);
});

it('says the sale is final when there is no window', () => {
  assert.equal(receiptPolicyLine({ windowHours: 0, deadlineAt: null }, t, formatDateTime), 'returns.receipt.none');
});

it('never prints a deadline the server did not send', () => {
  // A window with no deadline is not a state the server produces, but a receipt
  // must not invent one from the phone's clock if it ever appears.
  assert.equal(receiptPolicyLine({ windowHours: 48, deadlineAt: null }, t, formatDateTime), 'returns.receipt.none');
});

console.log('the history status');
it('is open, with the deadline, inside the window', () => {
  const s = policyStatus(view(), t, formatDateTime);
  assert.equal(s.tone, 'positive');
  assert.equal(s.label, 'returns.status.open');
  assert.match(s.detail!, /2026-08-16/);
});

it('distinguishes "no returns" from "expired"', () => {
  // Different facts. A customer told the wrong one argues about the wrong thing.
  const none = policyStatus(view({ reason: 'no_return_policy', windowHours: 0, deadlineAt: null }), t, formatDateTime);
  const expired = policyStatus(view({ reason: 'window_expired' }), t, formatDateTime);
  assert.equal(none.label, 'returns.status.none');
  assert.equal(expired.label, 'returns.status.expired');
  assert.notEqual(none.tone, expired.tone);
});

it('reports every reason the server can send, in words', () => {
  for (const reason of ['already_returned', 'sale_reversed', 'quantity_not_supported'] as const) {
    const s = policyStatus(view({ reason }), t, formatDateTime);
    assert.ok(s.label.startsWith('returns.status.'), `${reason} has no label`);
    // Colour alone is never the message.
    assert.ok(s.label.length > 0);
  }
});

console.log('what the Sell screen may offer');
it('offers an employee exactly the shop policy, and nothing else', () => {
  assert.deepEqual(allowedWindowChoices(48, false), [48]);
  assert.deepEqual(allowedWindowChoices(0, false), [0]);
});

it('lets a manager remove the window or lengthen it, never shorten it', () => {
  const choices = allowedWindowChoices(48, true);
  // 0 is allowed because it is explicit and the customer is told at the till.
  assert.ok(choices.includes(0));
  assert.ok(choices.includes(48));
  assert.ok(choices.includes(72));
  // 24 would be quietly selling a worse promise under the same banner.
  assert.ok(!choices.includes(24));
});

it('treats a shop with no returns as free to grant one', () => {
  const choices = allowedWindowChoices(0, true);
  assert.deepEqual(choices, [0, 24, 48, 72, 168]);
});

it('always includes the shop default, even an unusual one', () => {
  assert.ok(allowedWindowChoices(36, true).includes(36));
});

console.log(`\n${passed} assertions passed`);
