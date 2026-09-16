/**
 * Receiving a delivery from a file — the rules the review screen depends on.
 *
 *   node lib/file-receiving.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
  batchCounts,
  batchFingerprint,
  canConfirm,
  effectiveCost,
  effectiveImei2,
  effectiveProductId,
  entryState,
  groupEntries,
  purchaseItems,
  parseFailureKey,
  remainingProblems,
  type BatchState,
  type FileEntry,
  type ParseResult,
} from './file-receiving-rules.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  try { fn(); passed++; } catch (e) { console.error(`✗ ${name}`); throw e; }
};
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const code = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const entry = (over: Partial<FileEntry> & { key: string }): FileEntry => ({
  source: { sheet: 'Phones', row: 2, page: null },
  problems: [],
  extracted: {
    reference: null, category: 'Smartphone', brand: 'Apple', model: 'iPhone 12', storage: '128', colour: 'Black',
    condition: 'New', imei1: '990001000000018', imei2: null, serial: null, cost: 12500, currency: 'MRU',
  },
  ...over,
} as FileEntry);

const batchOf = (entries: FileEntry[], matches: Record<string, string | null> = {}): BatchState => ({
  parsed: {
    source: 'xlsx', filename: 'demo.xlsx', sheets: [], entries,
    matches: Object.fromEntries(entries.map((e) => [e.key, { productId: matches[e.key] ?? 'p1', candidates: [], exact: true }])),
    counts: { phones: entries.length, ready: 0, needsAttention: 0, excluded: 0, selectedCost: 0 },
    imageOnlyPages: [], pages: null,
  } as ParseResult,
  corrections: {},
  excluded: [],
});

// ── states ──────────────────────────────────────────────────────────────────

it('a phone with no problem is ready; one with a problem needs attention', () => {
  const b = batchOf([entry({ key: 'a' }), entry({ key: 'b', problems: ['cost_missing'] })]);
  assert.equal(entryState(b, b.parsed.entries[0]), 'ready');
  assert.equal(entryState(b, b.parsed.entries[1]), 'needs_attention');
});

it('a correction answers the problem it fixes, and only that one', () => {
  const e = entry({ key: 'a', problems: ['cost_missing', 'product_unknown'] });
  assert.deepEqual(remainingProblems(e, { cost: 900 }), ['product_unknown']);
  assert.deepEqual(remainingProblems(e, { cost: 900, productId: 'p9' }), []);
  assert.deepEqual(remainingProblems(e, {}), ['cost_missing', 'product_unknown']);
});

it('a duplicate is never fixed by editing the price', () => {
  const e = entry({ key: 'a', problems: ['duplicate_in_stock'] });
  assert.deepEqual(remainingProblems(e, { cost: 900 }), ['duplicate_in_stock']);
});

it('the correction is kept beside the file value, never over it', () => {
  const b = batchOf([entry({ key: 'a' })]);
  b.corrections.a = { cost: 9000 };
  assert.equal(effectiveCost(b, b.parsed.entries[0]), 9000);
  assert.equal(b.parsed.entries[0].extracted.cost, 12500, 'what the file said is untouched');
});

// ── counts ──────────────────────────────────────────────────────────────────

it('counts phones, ready, attention and excluded, and prices only what will be received', () => {
  const b = batchOf([
    entry({ key: 'a' }),
    entry({ key: 'b', problems: ['cost_missing'] }),
    entry({ key: 'c', extracted: { ...entry({ key: 'c' }).extracted, cost: 9500 } }),
  ]);
  b.excluded = ['c'];
  assert.deepEqual(batchCounts(b), { phones: 3, ready: 1, needsAttention: 1, excluded: 1, selectedCost: 12500 });
});

it('nothing may be confirmed while a phone is neither corrected nor excluded', () => {
  const b = batchOf([entry({ key: 'a' }), entry({ key: 'b', problems: ['imei1_invalid'] })]);
  assert.equal(canConfirm(b), false);
  b.excluded = ['b'];
  assert.equal(canConfirm(b), true);
});

it('an empty selection cannot be confirmed either', () => {
  const b = batchOf([entry({ key: 'a' })]);
  b.excluded = ['a'];
  assert.equal(canConfirm(b), false);
});

// ── what is sent ────────────────────────────────────────────────────────────

it('one row is one unit, and a second IMEI rides on the same unit', () => {
  const b = batchOf([entry({ key: 'a', extracted: { ...entry({ key: 'a' }).extracted, imei2: '990001000010017' } })]);
  const items = purchaseItems(b);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].units, [{ identifier: '990001000000018', imeiSecondary: '990001000010017' }]);
});

it('phones of the same product at different prices stay separate items', () => {
  const cheap = entry({ key: 'b' });
  cheap.extracted = { ...cheap.extracted, imei1: '990001000000026', cost: 9500 };
  const items = purchaseItems(batchOf([entry({ key: 'a' }), cheap]));
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => i.unitCost).sort((x, y) => x - y), [9500, 12500]);
});

it('excluded and unfixed phones are never sent', () => {
  const b = batchOf([entry({ key: 'a' }), entry({ key: 'b', problems: ['imei1_invalid'] }), entry({ key: 'c' })]);
  b.excluded = ['c'];
  const items = purchaseItems(b);
  assert.equal(items.flatMap((i) => i.units).length, 1);
});

it('a chosen product wins over the server guess', () => {
  const b = batchOf([entry({ key: 'a', problems: ['product_ambiguous'] })], { a: null });
  b.corrections.a = { productId: 'chosen' };
  assert.equal(effectiveProductId(b, b.parsed.entries[0]), 'chosen');
  assert.equal(purchaseItems(b)[0].productId, 'chosen');
});

it('a cleared second IMEI is actually cleared, not restored from the file', () => {
  const b = batchOf([entry({ key: 'a', extracted: { ...entry({ key: 'a' }).extracted, imei2: '990001000010017' } })]);
  b.corrections.a = { imei2: null };
  assert.equal(effectiveImei2(b, b.parsed.entries[0]), null);
  assert.deepEqual(purchaseItems(b)[0].units, [{ identifier: '990001000000018' }]);
});

// ── the idempotency key ─────────────────────────────────────────────────────

it('the same batch and payment give the same key, so a retry replays', () => {
  const b = batchOf([entry({ key: 'a' })]);
  const payment = { method: 'cash', receivingAccountId: null };
  assert.equal(batchFingerprint(purchaseItems(b), payment), batchFingerprint(purchaseItems(b), payment));
});

it('an edited batch or a changed payment gives a different key', () => {
  const b = batchOf([entry({ key: 'a' })]);
  const cash = { method: 'cash', receivingAccountId: null };
  const first = batchFingerprint(purchaseItems(b), cash);
  b.corrections.a = { cost: 9000 };
  assert.notEqual(batchFingerprint(purchaseItems(b), cash), first);
  assert.notEqual(batchFingerprint(purchaseItems(b), { method: 'bank', receivingAccountId: 'acc' }), first);
});

it('the key is shaped as a uuid, which the endpoint requires', () => {
  const key = batchFingerprint(purchaseItems(batchOf([entry({ key: 'a' })])), { method: 'cash', receivingAccountId: null });
  assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

// ── grouping ────────────────────────────────────────────────────────────────

it('groups by category, product and exact variant', () => {
  const other = entry({ key: 'b' });
  other.extracted = { ...other.extracted, colour: 'Blue', imei1: '990001000000026' };
  const groups = groupEntries(batchOf([entry({ key: 'a' }), other, entry({ key: 'c' })]));
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((g) => g.entries.length).sort(), [1, 2]);
  assert.equal(groups[0].label, 'Apple iPhone 12');
  assert.equal(groups[0].variant, '128 GB · Black');
});

// ── the screens ─────────────────────────────────────────────────────────────

it('the file button is in the Receive header, on the physical right in both directions', () => {
  const src = code(read('../app/receive.tsx'));
  assert.match(src, /headerLeft: \(\) => \(isRTL\(\) \? <FileImportButton \/> : <BackButton/);
  assert.match(src, /headerRight: \(\) => \(isRTL\(\) \? <BackButton[^)]*\/> : <FileImportButton \/>\)/);
  assert.match(src, /accessibilityLabel=\{t\('receive\.file\.action'\)\}/);
  // Owner-only, the same restriction opening-inventory import carries.
  assert.match(src, /usePermission\('import\.run'\)/);
  assert.match(src, /usePermission\('purchase\.manage'\)/);
  // It is not in the search row or the empty state.
  const scanRow = src.slice(src.indexOf('<ScanTarget'), src.indexOf('<ScanTarget') + 600);
  assert.ok(!scanRow.includes('FileImportButton'));
  assert.match(src, /t\('receive\.empty\.file'\)/, 'the empty state mentions receiving from a file');
});

it('the review confirms through the ordinary purchase endpoint, never the import one', () => {
  const src = code(read('../app/receive/file.tsx'));
  assert.match(src, /api\.post<PurchaseOutcome>\('\/purchases'/);
  assert.ok(!src.includes("'/imports'"), 'opening-inventory import has different cash semantics');
  assert.match(src, /clientUuid,/);
  assert.match(src, /batchFingerprint\(items/);
  assert.match(src, /<PurchasePaymentPicker value=\{payment\} onChange=\{setPayment\} \/>/);
  assert.match(src, /disabled=\{!canConfirm\(batch\) \|\| !purchasePaymentReady\(payment\) \|\| !branchId\}/);
  assert.match(src, /invalidateMoney\(qc\)/);
  for (const key of ['qk.home(branchId)', 'qk.inventory(branchId)', 'qk.inventorySummary(branchId)', 'qk.openClosing(branchId']) {
    assert.ok(src.includes(key), `must refresh ${key}`);
  }
});

it('reading a file writes nothing, and says so before the picker opens', () => {
  const src = code(read('../app/receive/pick.tsx'));
  assert.match(src, /t\('fileReceive\.pick\.nothingYet'\)/);
  assert.ok(!src.includes('api.post'), 'the picker only parses');
});

it('every new key exists in all three languages', () => {
  const keys = [
    'receive.file.action', 'receive.empty.file', 'fileReceive.title', 'fileReceive.confirm',
    'fileReceive.filter.attention', 'fileReceive.problem.duplicate_in_stock', 'fileReceive.imageOnly.body',
    'fileReceive.bulkCost.title', 'fileReceive.source.page',
  ];
  for (const locale of ['en', 'fr', 'ar']) {
    const cat = read(`./i18n/${locale}.ts`);
    for (const key of keys) assert.ok(cat.includes(`'${key}':`), `${locale} is missing ${key}`);
  }
});

it('both new routes are classified, so the drift test stays honest', () => {
  const registry = read('./navigation/registry.ts');
  assert.match(registry, /'\/receive\/pick': '[^']+'/);
  assert.match(registry, /'\/receive\/file': '[^']+'/);
});

// ── the phone said the workbook was bad, and the workbook was perfect ───────
//
// The shop's API had not been restarted after the feature shipped, so
// POST /purchases/file/parse answered 404. Every failure — 404 included — was
// shown as the single sentence "That file could not be read", which accused the
// file. These fix the accusation: each failure now says what actually happened,
// and a missing endpoint says the server needs updating.

it('a missing endpoint blames the server, not the workbook', () => {
  assert.equal(parseFailureKey(404), 'fileReceive.error.endpointMissing');
});

it('a request that never arrived is not reported as a bad file', () => {
  assert.equal(parseFailureKey(null), 'fileReceive.error.offline');
  assert.equal(parseFailureKey(0, 'offline'), 'fileReceive.error.offline');
});

it('each failure the server can return has its own message', () => {
  assert.equal(parseFailureKey(401), 'fileReceive.error.unauthorized');
  assert.equal(parseFailureKey(403), 'fileReceive.error.forbidden');
  assert.equal(parseFailureKey(413), 'fileReceive.error.tooLarge');
  assert.equal(parseFailureKey(400, 'file_too_large'), 'fileReceive.error.tooLarge');
  assert.equal(parseFailureKey(400, 'file_missing'), 'fileReceive.error.empty');
  assert.equal(parseFailureKey(400, 'file_empty'), 'fileReceive.error.noSheet');
  assert.equal(parseFailureKey(400, 'pdf_no_table'), 'fileReceive.error.noSheet');
  assert.equal(parseFailureKey(400, 'file_type_unsupported'), 'fileReceive.error.unsupported');
  assert.equal(parseFailureKey(400, 'file_unreadable'), 'fileReceive.error.corrupt');
  assert.equal(parseFailureKey(400, 'pdf_image_only'), 'fileReceive.error.pdfImageOnly');
  assert.equal(parseFailureKey(500), 'fileReceive.error.server');
  assert.equal(parseFailureKey(503), 'fileReceive.error.server');
});

it('the server code decides, whatever status carried it', () => {
  // A code the server sent under a status the mapping also knows must still win:
  // "that PDF is photographs" beats the generic "unsupported".
  assert.equal(parseFailureKey(400, 'pdf_image_only'), 'fileReceive.error.pdfImageOnly');
  assert.equal(parseFailureKey(413, 'file_too_large'), 'fileReceive.error.tooLarge');
});

it('every message it can choose exists in all three languages', () => {
  const src = read('./file-receiving-rules.ts');
  const keys = [...src.matchAll(/'(fileReceive\.error\.[a-zA-Z]+)'/g)].map((m) => m[1]);
  assert.ok(keys.length >= 11, `expected the whole set, found ${keys.length}`);
  for (const locale of ['en', 'fr', 'ar']) {
    const cat = read(`./i18n/${locale}.ts`);
    for (const key of [...keys, 'fileReceive.error.noBranch']) {
      assert.ok(cat.includes(`'${key}':`), `${locale} is missing ${key}`);
    }
  }
});

it('the picker shows the mapped message and offers to try again', () => {
  const src = code(read('../app/receive/pick.tsx'));
  assert.match(src, /parseFailureKey\(status, code\)/, 'the mapping decides the message');
  assert.ok(!src.includes("t('fileReceive.failed')"), 'the catch-all sentence is gone');
  assert.match(src, /t\('action\.retry'\)/, 'a retry is offered');
  assert.match(src, /fileReceive\.error\.noBranch/, 'a missing branch says so');
});

it('technical detail stays in development, never on the shop screen', () => {
  const src = code(read('../app/receive/pick.tsx'));
  assert.match(src, /if \(__DEV__\)/, 'the diagnostic log is development-only');
  const shown = src.slice(src.indexOf('InlineNotice'));
  assert.ok(!/status|mimeType/.test(shown.slice(0, 400)), 'no status codes in the notice');
});

it('a phone sends the file itself, never a uri it could not open', () => {
  const src = code(read('./file-receiving.ts'));
  // The uri part is still the first attempt — it is the app's established
  // transport — but a failure retries with the real bytes.
  assert.match(src, /new File\(decodeURI\(input\.uri\)\)\.bytes\(\)/, 'the bytes are read as a fallback');
  assert.match(src, /found\.size === 0/, 'an empty file is caught before sending');
  assert.ok(!/'content-type'|Content-Type/i.test(src), 'no hand-set content type, or the boundary is lost');
  assert.match(src, /form\.append\('file'/, 'the multipart field is named file');
});

console.log(`file receiving: ${passed} passed`);
