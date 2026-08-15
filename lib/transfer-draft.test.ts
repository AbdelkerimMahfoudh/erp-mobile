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
  addStockToDraft,
  addUnitToDraft,
  canSubmitDraft,
  hasUnsavedDraft,
  isFinishedStatus,
  removeUnitFromDraft,
  shouldMintNewRequestId,
  submitIntent,
  type DraftLine,
  type StockCandidate,
} from './transfer-draft.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
};

const empty: DraftLine[] = [];

/** An accessory as the server described it, with room to send three. */
const cable = (over: Partial<StockCandidate> = {}): StockCandidate => ({
  productId: 'p1',
  product: 'USB-C cable',
  variant: '1m',
  barcode: '6001234567890',
  physicalQuantity: 5,
  reservedQuantity: 2,
  availableQuantity: 3,
  ...over,
});

it('adds a scanned identifier with what it is', () => {
  const r = addUnitToDraft(empty, '356938035643809', { product: 'Samsung Galaxy A14' });
  assert.equal(r.ok, true);
  assert.equal(r.reason, null);
  assert.deepEqual(r.lines, [
    { kind: 'unit', identifier: '356938035643809', product: 'Samsung Galaxy A14' },
  ]);
});

it('trims what was typed, so a stray space is not a different phone', () => {
  const r = addUnitToDraft(empty, '  356938035643809 ');
  assert.equal((r.lines[0] as { identifier: string }).identifier, '356938035643809');
});

it('REPORTS a duplicate rather than silently collapsing it', () => {
  const once = addUnitToDraft(empty, '356938035643809').lines;
  const twice = addUnitToDraft(once, '356938035643809');
  assert.equal(twice.ok, false);
  assert.equal(twice.reason, 'duplicate');
  // The draft is unchanged — scanning twice must not look like adding two.
  assert.equal(twice.lines.length, 1);
});

it('refuses a blank identifier', () => {
  assert.equal(addUnitToDraft(empty, '   ').reason, 'blank');
});

/**
 * H1.4 replaced the old "quantity products are refused" rule. A quantity
 * product is no longer an error — it is a different KIND of line, because
 * scanning the same box of cables twice means two of them. So the assertion
 * that used to prove the refusal now proves the merge.
 */
it('MERGES a quantity product instead of refusing it, because two scans mean two', () => {
  const once = addStockToDraft(empty, cable(), 1);
  assert.equal(once.ok, true);
  assert.equal(once.lines.length, 1);

  const twice = addStockToDraft(once.lines, cable(), 1);
  assert.equal(twice.ok, true);
  assert.equal(twice.merged, true);
  // One line, counting two — not two lines the server would reject.
  assert.equal(twice.lines.length, 1);
  assert.equal((twice.lines[0] as { quantity: number }).quantity, 2);
});

it('will not promise more of an accessory than the server said was free', () => {
  const r = addStockToDraft(empty, cable(), 4);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'over_available');
  assert.equal(r.lines.length, 0);
});

it('refuses an accessory with nothing free, separately from having none at all', () => {
  const r = addStockToDraft(empty, cable({ availableQuantity: 0 }), 1);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'none_available');
});

it('removes exactly one serialized line', () => {
  const two = addUnitToDraft(addUnitToDraft(empty, 'A').lines, 'B').lines;
  assert.deepEqual(
    removeUnitFromDraft(two, 'A').map((l) => (l as { identifier: string }).identifier),
    ['B'],
  );
});

it('needs lines and a DIFFERENT destination branch', () => {
  const lines = addUnitToDraft(empty, 'A').lines;
  assert.equal(canSubmitDraft({ lines, toBranchId: 'b2', fromBranchId: 'b1' }), true);
  assert.equal(canSubmitDraft({ lines: [], toBranchId: 'b2', fromBranchId: 'b1' }), false);
  assert.equal(canSubmitDraft({ lines, toBranchId: null, fromBranchId: 'b1' }), false);
  // Same branch: the server answers 400, so never make the user wait for it.
  assert.equal(canSubmitDraft({ lines, toBranchId: 'b1', fromBranchId: 'b1' }), false);
});

it('will not submit an accessory line that exceeds what is free', () => {
  const lines = addStockToDraft(empty, cable(), 3).lines;
  assert.equal(canSubmitDraft({ lines, toBranchId: 'b2', fromBranchId: 'b1' }), true);
  // Mutated past the ceiling by any route: submit stays shut.
  const over = [{ ...(lines[0] as object), quantity: 9 }] as DraftLine[];
  assert.equal(canSubmitDraft({ lines: over, toBranchId: 'b2', fromBranchId: 'b1' }), false);
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
  const lines = addUnitToDraft(empty, 'A').lines;
  assert.equal(hasUnsavedDraft(lines, false), true);
  assert.equal(hasUnsavedDraft(lines, true), false);
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
