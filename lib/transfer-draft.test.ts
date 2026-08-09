/**
 * Regression guard for transfer draft rules (H1.3).
 *
 * Run directly with Node (type-stripping), no test runner or new dependency:
 *   node lib/transfer-draft.test.ts
 * Exits non-zero on any failure.
 *
 * These are the rules a shop notices when they are wrong: a phone counted
 * twice, an accessory silently dropped, a retry that creates a second transfer,
 * or a half-scanned draft lost to the back button.
 */
import assert from 'node:assert/strict';
import {
  addToDraft,
  canSubmitDraft,
  hasUnsavedDraft,
  isFinishedStatus,
  removeFromDraft,
  shouldMintNewRequestId,
  submitIntent,
  type DraftItem,
} from './transfer-draft.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
};

const empty: DraftItem[] = [];

it('adds a scanned identifier with what it is', () => {
  const r = addToDraft(empty, '356938035643809', { product: 'Samsung Galaxy A14' });
  assert.equal(r.ok, true);
  assert.equal(r.reason, null);
  assert.deepEqual(r.items, [{ identifier: '356938035643809', product: 'Samsung Galaxy A14' }]);
});

it('trims what was typed, so a stray space is not a different phone', () => {
  const r = addToDraft(empty, '  356938035643809 ');
  assert.equal(r.items[0].identifier, '356938035643809');
});

it('REPORTS a duplicate rather than silently collapsing it', () => {
  const once = addToDraft(empty, '356938035643809').items;
  const twice = addToDraft(once, '356938035643809');
  assert.equal(twice.ok, false);
  assert.equal(twice.reason, 'duplicate');
  // The draft is unchanged — scanning twice must not look like adding two.
  assert.equal(twice.items.length, 1);
});

it('refuses a blank identifier', () => {
  assert.equal(addToDraft(empty, '   ').reason, 'blank');
});

it('refuses a quantity product with its own reason, never silently', () => {
  const r = addToDraft(empty, 'ACC-001', { trackingType: 'quantity' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'quantity_product');
  assert.equal(r.items.length, 0);
});

it('removes exactly one item', () => {
  const two = addToDraft(addToDraft(empty, 'A').items, 'B').items;
  assert.deepEqual(removeFromDraft(two, 'A').map((i) => i.identifier), ['B']);
});

it('needs items and a DIFFERENT destination branch', () => {
  const items = addToDraft(empty, 'A').items;
  assert.equal(canSubmitDraft({ items, toBranchId: 'b2', fromBranchId: 'b1' }), true);
  assert.equal(canSubmitDraft({ items: [], toBranchId: 'b2', fromBranchId: 'b1' }), false);
  assert.equal(canSubmitDraft({ items, toBranchId: null, fromBranchId: 'b1' }), false);
  // Same branch: the server answers 400, so never make the user wait for it.
  assert.equal(canSubmitDraft({ items, toBranchId: 'b1', fromBranchId: 'b1' }), false);
});

it('keeps ONE request id across retries, which is what makes a retry safe', () => {
  assert.equal(shouldMintNewRequestId('draft_started'), true);
  assert.equal(shouldMintNewRequestId('submitting'), false);
  // The whole point: a timeout retried under the same key returns the original
  // transfer instead of moving stock a second time.
  assert.equal(shouldMintNewRequestId('retry'), false);
  assert.equal(shouldMintNewRequestId('completed'), true);
});

it('warns about leaving only while there is unsent work', () => {
  const items = addToDraft(empty, 'A').items;
  assert.equal(hasUnsavedDraft(items, false), true);
  assert.equal(hasUnsavedDraft(items, true), false);
  assert.equal(hasUnsavedDraft([], false), false);
});

it('says on the button whether this will need approving', () => {
  assert.equal(submitIntent(true), 'creates_approved');
  assert.equal(submitIntent(false), 'awaits_approval');
});

it('knows which statuses are finished', () => {
  for (const s of ['received', 'rejected', 'cancelled'] as const) {
    assert.equal(isFinishedStatus(s), true);
  }
  for (const s of ['pending_approval', 'approved', 'in_transit'] as const) {
    assert.equal(isFinishedStatus(s), false);
  }
});

console.log(`\n${passed} transfer-draft checks passed`);
