import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  batchCounts,
  canConfirm,
  effectiveProductId,
  entryState,
  groupEntries,
  groupSummary,
  linkableKeys,
  prefillFromGroup,
  withLinkedProduct,
  type BatchState,
  type FileEntry,
  type ParseResult,
} from './file-receiving-rules.ts';

/**
 * The 2026-10-05 screenshot: a delivery file with Samsung Galaxy A14 rows the
 * catalogue does not know ("No matching product", Accept disabled) beside iPhone
 * rows that are ready. Creating the product from the review must link exactly
 * those rows, leave everything else alone, and make the delivery confirmable —
 * without a single unit existing until the person confirms.
 */

function entry(key: string, over: Partial<FileEntry['extracted']> & { problems?: FileEntry['problems'] }): FileEntry {
  const { problems = [], ...ex } = over;
  return {
    key,
    source: { sheet: 'Delivery', row: Number(key.replace(/\D/g, '')) || null, page: null },
    extracted: {
      reference: null,
      category: 'Phone',
      brand: 'Samsung',
      model: 'Galaxy A14',
      storage: '128',
      colour: 'Black',
      condition: null,
      imei1: `35${key.replace(/\D/g, '').padStart(13, '0')}`,
      imei2: null,
      serial: null,
      cost: 162000,
      currency: 'MRU',
      ...ex,
    },
    problems,
  };
}

const IPHONE = { id: 'p-iphone', brand: 'Apple', model: 'iPhone 13', variant: '128 GB', trackingType: 'imei' as const };
const A14 = { id: 'p-a14', brand: 'Samsung', model: 'Galaxy A14', variant: '128 GB · Black', trackingType: 'imei' as const };

function screenshotBatch(): BatchState {
  const entries = [
    entry('r1', { problems: ['product_unknown'] }),
    entry('r2', { problems: ['product_unknown'] }),
    // the same model, another variant: its own group, its own decision
    entry('r3', { storage: '256', problems: ['product_unknown'] }),
    // an unknown product AND an invalid IMEI: a product alone does not fix it
    entry('r4', { imei1: '12', problems: ['product_unknown', 'imei1_invalid'] }),
    entry('r5', { brand: 'Apple', model: 'iPhone 13', storage: '128', colour: 'Blue' }),
    entry('r6', { brand: 'Apple', model: 'iPhone 13', storage: '128', colour: 'Blue' }),
  ];
  const parsed: ParseResult = {
    source: 'xlsx',
    filename: 'delivery.xlsx',
    sheets: [{ name: 'Delivery', rows: 6, columns: [], missing: [], selected: true, looksExplanatory: false }],
    entries,
    matches: {
      r1: { productId: null, candidates: [], exact: false },
      r2: { productId: null, candidates: [], exact: false },
      r3: { productId: null, candidates: [], exact: false },
      r4: { productId: null, candidates: [], exact: false },
      r5: { productId: IPHONE.id, candidates: [IPHONE], exact: true },
      r6: { productId: IPHONE.id, candidates: [IPHONE], exact: true },
    },
    counts: { phones: 6, ready: 2, needsAttention: 4, excluded: 0, selectedCost: 324000 },
    imageOnlyPages: [],
    pages: null,
  };
  return { parsed, corrections: {}, excluded: [], acknowledged: [] };
}

test('the screenshot: the Samsung rows need a product, the iPhone rows are ready, nothing can be confirmed', () => {
  const batch = screenshotBatch();
  assert.equal(entryState(batch, batch.parsed.entries[0]!), 'needs_attention');
  assert.equal(entryState(batch, batch.parsed.entries[4]!), 'ready');
  assert.equal(canConfirm(batch), false);
  assert.deepEqual(batchCounts(batch), { phones: 6, ready: 2, needsAttention: 4, excluded: 0, selectedCost: 324000 });
});

test('the form is filled in only from what the file said, and the identifier decides the tracking mode', () => {
  const batch = screenshotBatch();
  const group = groupEntries(batch).find((g) => g.label === 'Samsung Galaxy A14' && g.variant === '128 GB · Black')!;
  assert.deepEqual(prefillFromGroup(group), { brand: 'Samsung', model: 'Galaxy A14', variant: '128 GB · Black', trackingType: 'imei' });
  const serialOnly = { ...group, entries: group.entries.map((e) => ({ ...e, extracted: { ...e.extracted, imei1: null, serial: 'SN-1' } })) };
  assert.equal(prefillFromGroup(serialOnly).trackingType, 'serial');
});

test('one product answers for the rows waiting on it — and not for the row with a bad IMEI', () => {
  const batch = screenshotBatch();
  const group = groupEntries(batch).find((g) => g.variant === '128 GB · Black')!;
  // r1, r2 and r4 share the group; r4 is held by its IMEI as well, so the group is not "one decision".
  assert.deepEqual(group.entries.map((e) => e.key), ['r1', 'r2', 'r4']);
  assert.deepEqual(groupSummary(batch, group).matchableKeys, []);
  // Exclude the broken row: now the group is exactly the two rows a product fixes.
  const withoutBad = { ...batch, excluded: ['r4'] };
  assert.deepEqual(linkableKeys(withoutBad, group.key), ['r1', 'r2']);
});

test('linking makes the rows ready, names the product on each, and touches nothing else', () => {
  const batch = { ...screenshotBatch(), excluded: ['r4'] };
  const group = groupEntries(batch).find((g) => g.variant === '128 GB · Black')!;
  const after = withLinkedProduct(batch, linkableKeys(batch, group.key), A14);

  for (const key of ['r1', 'r2']) {
    const e = after.parsed.entries.find((x) => x.key === key)!;
    assert.equal(entryState(after, e), 'ready');
    assert.equal(effectiveProductId(after, e), A14.id);
    assert.ok(after.parsed.matches[key]!.candidates.some((c) => c.id === A14.id), 'the sheet can name it');
  }
  // The 256 GB group is its own decision and still waits.
  assert.equal(entryState(after, after.parsed.entries.find((x) => x.key === 'r3')!), 'needs_attention');
  assert.equal(effectiveProductId(after, after.parsed.entries.find((x) => x.key === 'r3')!), null);
  // The excluded row stays excluded; the iPhone rows are untouched; the file's words are untouched.
  assert.equal(entryState(after, after.parsed.entries.find((x) => x.key === 'r4')!), 'excluded');
  assert.deepEqual(after.parsed.matches.r5, batch.parsed.matches.r5);
  assert.deepEqual(after.parsed.entries, batch.parsed.entries);
  assert.equal(batchCounts(after).ready, 4);
  assert.equal(canConfirm(after), false, 'the 256 GB row is still waiting');
});

test('linking the second variant too makes the delivery confirmable; linking twice changes nothing more', () => {
  const batch = { ...screenshotBatch(), excluded: ['r4'] };
  const groups = groupEntries(batch);
  const g128 = groups.find((g) => g.variant === '128 GB · Black')!;
  const g256 = groups.find((g) => g.variant === '256 GB · Black')!;
  const A14_256 = { ...A14, id: 'p-a14-256', variant: '256 GB · Black' };
  let after = withLinkedProduct(batch, linkableKeys(batch, g128.key), A14);
  after = withLinkedProduct(after, linkableKeys(after, g256.key), A14_256);
  assert.equal(canConfirm(after), true);
  const again = withLinkedProduct(after, ['r1', 'r2'], A14);
  assert.deepEqual(again, after);
});

test('cancelling the form changes nothing; an interrupted review restores with the link intact', () => {
  const batch = { ...screenshotBatch(), excluded: ['r4'] };
  assert.deepEqual(withLinkedProduct(batch, [], A14), batch);
  const group = groupEntries(batch).find((g) => g.variant === '128 GB · Black')!;
  const linked = withLinkedProduct(batch, linkableKeys(batch, group.key), A14);
  const restored = JSON.parse(JSON.stringify(linked)) as BatchState;
  assert.equal(entryState(restored, restored.parsed.entries[0]!), 'ready');
  assert.equal(effectiveProductId(restored, restored.parsed.entries[0]!), A14.id);
});
