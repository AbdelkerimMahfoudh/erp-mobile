/**
 * The flattened review list — proved without a screen.
 *
 *   node lib/file-review-rows.test.ts
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { groupEntries, maskIdentifier, type BatchState, type FileEntry } from './file-receiving-rules.ts';
import { groupSummaries, reviewRows, toggleOpenGroup } from './file-review-rows.ts';

const entry = (key: string, over: Partial<FileEntry['extracted']> = {}, problems: FileEntry['problems'] = []): FileEntry => ({
  key,
  source: { sheet: 'Phones', row: Number(key.replace(/\D/g, '')) + 1, page: null },
  extracted: {
    reference: null, category: 'Phones', brand: 'Apple', model: 'iPhone 12', storage: '128', colour: 'Black', condition: null,
    imei1: `99000100000${String(Number(key.replace(/\D/g, ''))).padStart(4, '0')}`, imei2: null, serial: null, cost: 12500, currency: 'MRU', ...over,
  },
  problems,
});

/** Ten groups of ten, like the real workbook. */
function hundred(): BatchState {
  const entries: FileEntry[] = [];
  for (let g = 0; g < 10; g++) {
    for (let i = 0; i < 10; i++) {
      entries.push(entry(`r${g * 10 + i}`, { model: `Model ${g}` }, g < 7 ? ['product_unknown'] : []));
    }
  }
  return { parsed: { source: 'xlsx', filename: 'x.xlsx', sheets: [], entries, matches: {}, counts: { phones: 100, ready: 30, needsAttention: 70, excluded: 0, selectedCost: 0 }, imageOnlyPages: [], pages: null }, corrections: {}, excluded: [], acknowledged: [] };
}

it('a hundred rows in ten closed groups are ten records — no row is built for a closed group', () => {
  const b = hundred();
  const groups = groupEntries(b);
  const rows = reviewRows(b, groups, groupSummaries(b, groups), null, 'all');
  assert.equal(rows.length, 10);
  assert.ok(rows.every((r) => r.type === 'group' && !r.open));
});

it('opening one group adds exactly its rows, after its header, and nothing for the others', () => {
  const b = hundred();
  const groups = groupEntries(b);
  const rows = reviewRows(b, groups, groupSummaries(b, groups), groups[3].key, 'all');
  assert.equal(rows.length, 20);
  assert.equal(rows[3].type, 'group');
  assert.equal((rows[3] as { open: boolean }).open, true);
  const opened = rows.slice(4, 14);
  assert.ok(opened.every((r) => r.type === 'entry' && r.groupKey === groups[3].key));
  assert.equal(rows[14].type, 'group');
});

it('only one group is ever open: opening another closes the first, opening the open one closes it', () => {
  assert.equal(toggleOpenGroup(null, 'a'), 'a');
  assert.equal(toggleOpenGroup('a', 'b'), 'b');
  assert.equal(toggleOpenGroup('a', 'a'), null);
});

it('keys are unique and stable across changes, so a correction never remounts the list', () => {
  const b = hundred();
  const groups = groupEntries(b);
  const before = reviewRows(b, groups, groupSummaries(b, groups), groups[0].key, 'all');
  b.corrections.r3 = { productId: 'p1' };
  const after = reviewRows(b, groupEntries(b), groupSummaries(b, groupEntries(b)), groups[0].key, 'all');
  assert.deepEqual(after.map((r) => r.key), before.map((r) => r.key));
  assert.equal(new Set(after.map((r) => r.key)).size, after.length);
  // The changed row changed; its neighbours carry the same values as before.
  const row = (rows: typeof before, key: string) => rows.find((r) => r.type === 'entry' && r.entryKey === key) as { state: string; problems: string[] };
  assert.equal(row(after, 'r3').state, 'ready');
  assert.deepEqual(row(after, 'r3').problems, []);
  assert.deepEqual(row(after, 'r4'), row(before, 'r4'));
});

it('the filter shows only matching rows and drops a group with none — without touching what is open', () => {
  const b = hundred();
  b.excluded = ['r5'];
  const groups = groupEntries(b);
  const rows = reviewRows(b, groups, groupSummaries(b, groups), groups[0].key, 'excluded');
  assert.equal(rows.length, 2, 'one group has an excluded row; the other nine are not listed');
  assert.equal((rows[0] as { shown: number }).shown, 1);
  assert.equal((rows[1] as { entryKey: string }).entryKey, 'r5');
});

it('each row carries what its line needs — state, cost, problems, acceptability — and never the whole batch', () => {
  const b = hundred();
  b.corrections.r70 = { cost: 9000 };
  const groups = groupEntries(b);
  const rows = reviewRows(b, groups, groupSummaries(b, groups), groups[7].key, 'all');
  const r70 = rows.find((r) => r.type === 'entry' && r.entryKey === 'r70') as Record<string, unknown>;
  assert.equal(r70.cost, 9000);
  assert.equal(r70.extractedCost, 12500);
  assert.equal(r70.corrected, true);
  assert.equal(r70.state, 'ready');
  // A product chosen for a row is not a cost correction: the caption about the file's cost stays off (docs/55 D51).
  b.corrections.r71 = { productId: 'p-chosen' };
  const rows2 = reviewRows(b, groups, groupSummaries(b, groups), groups[7].key, 'all');
  const r71 = rows2.find((r) => r.type === 'entry' && r.entryKey === 'r71') as Record<string, unknown>;
  assert.equal(r71.corrected, false);
  assert.equal(r70.acceptable, false, 'nothing advisory to accept');
  assert.equal(r70.identifier, '990001000000070');
  assert.equal(r70.identifierKind, 'imei');
  assert.ok(!('batch' in r70) && !('entry' in r70));
});

it('a serial-tracked row is labelled a serial, never given an IMEI it does not have', () => {
  const b = hundred();
  b.parsed.entries[0].extracted.imei1 = null;
  b.parsed.entries[0].extracted.serial = 'CAN-1662030-0019';
  const groups = groupEntries(b);
  const rows = reviewRows(b, groups, groupSummaries(b, groups), groups[0].key, 'all');
  const row = rows.find((r) => r.type === 'entry' && r.entryKey === 'r0') as { identifier: string; identifierKind: string };
  assert.equal(row.identifier, 'CAN-1662030-0019');
  assert.equal(row.identifierKind, 'serial');
});

it('the list masks an identifier to its last four; a short one is shown as it is', () => {
  assert.equal(maskIdentifier('990001000000070'), '•••• 0070');
  assert.equal(maskIdentifier('CAN-1662030-0019'), '•••• 0019');
  assert.equal(maskIdentifier('AB12'), 'AB12');
});

it('the screen renders the flattened records through one virtualized list, and rows get primitives', () => {
  const src = readFileSync(new URL('../app/receive/file.tsx', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(src, /reviewRows\(batch, groups, summaries, openKey, filter\)/);
  assert.match(src, /toggleOpenGroup\(current, key\)/);
  assert.equal((src.match(/<FlatList/g) ?? []).length, 1, 'one list');
  // The only vertical scroll view is the item sheet's own; the list is the screen's scroller.
  const sheetAt = src.indexOf('function ItemSheet(');
  for (const m of src.matchAll(/<ScrollView\b[^>]*/g)) {
    assert.ok(/\bhorizontal\b/.test(m[0]) || m.index > sheetAt, 'no list inside a vertical scroll view');
  }
  assert.match(src, /const GroupRow = React\.memo/);
  assert.match(src, /const EntryRow = React\.memo/);
  assert.doesNotMatch(src, /<GroupRow[\s\S]{0,400}batch=\{/, 'a group row never receives the batch');
  assert.doesNotMatch(src, /<EntryRow[\s\S]{0,600}(batch|entry)=\{/, 'a row never receives the batch or the entry object');
  assert.match(src, /useMemo\(\(\) => \(batch \? batchCounts\(batch\)/, 'counts are computed once per change');
  assert.match(src, /useMemo\(\(\) => \(batch \? purchaseItems\(batch\)/, 'the payload is computed once per change');
});

console.log('file-review-rows: all assertions passed');
