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
  canAccept,
  canConfirm,
  effectiveCost,
  effectiveImei2,
  effectiveProductId,
  entryState,
  groupEntries,
  hardProblems,
  advisoryProblems,
  purchaseItems,
  groupCandidates,
  groupSummary,
  parseFailureKey,
  previewBulkCost,
  remainingProblems,
  reviewComplete,
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
  acknowledged: [],
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

// ── accepting an advisory flag (Accept / mark ready) ─────────────────────────

it('a formula-derived value only needs a look; accepting it makes the phone ready', () => {
  const b = batchOf([entry({ key: 'a', problems: ['formula_value'] })]);
  assert.equal(entryState(b, b.parsed.entries[0]), 'needs_attention');
  assert.deepEqual(advisoryProblems(b.parsed.entries[0], undefined), ['formula_value']);
  assert.deepEqual(hardProblems(b.parsed.entries[0], undefined), []);
  assert.equal(canAccept(b, b.parsed.entries[0]), true);

  const accepted = { ...b, acknowledged: ['a'] };
  assert.equal(entryState(accepted, accepted.parsed.entries[0]), 'ready');
  assert.equal(canAccept(accepted, accepted.parsed.entries[0]), false); // nothing left to accept
});

it('a hard problem can never be accepted — it must be corrected or excluded', () => {
  const b = batchOf([entry({ key: 'a', problems: ['imei1_missing'] })]);
  assert.equal(canAccept(b, b.parsed.entries[0]), false);
  // Even if the acknowledgement flag were set, a hard problem still blocks.
  const forced = { ...b, acknowledged: ['a'] };
  assert.equal(entryState(forced, forced.parsed.entries[0]), 'needs_attention');
});

it('a clean phone is already ready, with nothing to accept', () => {
  const b = batchOf([entry({ key: 'a' })]);
  assert.equal(entryState(b, b.parsed.entries[0]), 'ready');
  assert.equal(canAccept(b, b.parsed.entries[0]), false);
});

it('acceptance is per phone, and the delivery confirms only once every advisory row is looked at', () => {
  const b = {
    ...batchOf([entry({ key: 'a', problems: ['formula_value'] }), entry({ key: 'b', problems: ['formula_value'] })]),
    acknowledged: ['a'],
  };
  assert.equal(entryState(b, b.parsed.entries[0]), 'ready');
  assert.equal(entryState(b, b.parsed.entries[1]), 'needs_attention');
  assert.equal(canConfirm(b), false);

  const both = { ...b, acknowledged: ['a', 'b'] };
  assert.equal(canConfirm(both), true);
  assert.deepEqual(batchCounts(both), { phones: 2, ready: 2, needsAttention: 0, excluded: 0, selectedCost: 25000 });
});

it('an excluded row is never acceptable', () => {
  const b = { ...batchOf([entry({ key: 'a', problems: ['formula_value'] })]), excluded: ['a'] };
  assert.equal(canAccept(b, b.parsed.entries[0]), false);
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

// ── the fault the iPhone actually hit ───────────────────────────────────────
//
// Everything else on the phone was talking to the server — a phone had just
// been registered and a sale completed — and only the upload reported itself
// as offline. React Native builds its multipart part from the picker's uri
// inside the networking layer, so a uri the document provider no longer lets
// the app read fails there: no status, no response, and a message that reads
// exactly like the Wi-Fi being down. The file is now copied into the app's own
// cache, checked there, and uploaded from that copy by the platform.

it('the file is copied into the app cache before anything is sent', () => {
  const src = code(read('./file-receiving.ts'));
  assert.match(src, /Paths\.cache/, 'the copy lands in the app cache');
  assert.match(src, /source\.copy\(destination\)/, 'the picked file is copied, not referenced');
  const copyAt = src.indexOf('cacheCopy(input)');
  const uploadAt = src.indexOf('.upload(url');
  assert.ok(copyAt > 0 && uploadAt > copyAt, 'the copy happens before the upload');
});

it('the cached copy is checked before it is sent', () => {
  const src = code(read('./file-receiving.ts'));
  assert.match(src, /if \(!file\.exists\)/, 'it must exist');
  assert.match(src, /size === 0/, 'it must not be empty');
  assert.match(src, /input\.size !== size/, 'it must weigh what the picker said');
  assert.match(src, /ZIP_SIGNATURE/, 'a workbook must start with a ZIP signature');
  assert.match(src, /\.xlsx\$\/i\.test\(input\.name\)/, 'the name must still be a workbook');
});

it('a workbook is recognised by its first four bytes, not its name alone', () => {
  const src = code(read('./file-receiving.ts'));
  assert.match(src, /0x50, 0x4b, 0x03, 0x04/, 'PK\\x03\\x04');
  assert.match(src, /readBytes\(length\)/, 'only the head is read, not the whole workbook');
});

it('the phone uploads through the platform, not through a JavaScript multipart body', () => {
  const src = code(read('./file-receiving.ts'));
  assert.match(src, /uploadType: UploadType\.MULTIPART/, 'the established Expo uploader');
  assert.match(src, /fieldName: 'file'/, 'the multipart field is still named file');
  assert.ok(!/'content-type'|Content-Type/i.test(src), 'no hand-set content type, or the boundary is lost');
  // The uri part that failed on the device must not be reachable on a phone.
  assert.ok(!/uri: input\.uri, name: input\.name/.test(src), 'no uri-built multipart part remains');
});

it('the upload uses the same origin and headers as every other call', () => {
  const src = code(read('./file-receiving.ts'));
  assert.match(src, /\${API_V1_URL}\/purchases\/file\/parse/, 'the shared API origin, not a hand-built URL');
  assert.ok(!/https?:\/\//.test(src), 'no origin is written into this helper');
  assert.match(src, /authorization: `Bearer \${token}`/, 'the same authorisation header');
  assert.match(src, /'x-branch-id': branchId/, 'the same branch header');
});

it('a local failure is never reported as the server being offline', () => {
  assert.equal(parseFailureKey(0, 'file_gone'), 'fileReceive.error.gone');
  assert.equal(parseFailureKey(0, 'file_empty_local'), 'fileReceive.error.empty');
  assert.equal(parseFailureKey(0, 'upload_failed'), 'fileReceive.error.uploadFailed');
  assert.equal(parseFailureKey(0, 'file_unreadable'), 'fileReceive.error.corrupt');
  // Only a server that genuinely did not answer says so.
  assert.equal(parseFailureKey(0, 'offline'), 'fileReceive.error.offline');
});

it('"offline" is claimed only after asking whether the server answers', () => {
  const src = code(read('./file-receiving.ts'));
  assert.match(src, /serverAnswers\(token\)/, 'reachability is tested before blaming the network');
  assert.match(src, /reachable[\s\S]{0,120}upload_failed/, 'a reachable server means the upload failed, not the network');
});

it('every stage the upload passes through is named, and logs metadata only', () => {
  const src = code(read('./file-receiving.ts'));
  for (const name of ['picked', 'copied', 'verified', 'started', 'answered']) {
    assert.match(src, new RegExp(`stage\\('${name}'`), `the ${name} stage is traced`);
  }
  assert.match(src, /if \(__DEV__\) console\.log/, 'the trace is development-only');
  assert.ok(!/bytes\(\)[\s\S]{0,40}console|console[\s\S]{0,60}token/.test(src), 'no contents or tokens are logged');
});

it('a retry reuses the cached copy when the picker cannot give the file again', () => {
  const src = code(read('./file-receiving.ts'));
  assert.match(src, /destination\.exists && \(destination\.size \?\? 0\) > 0/, 'an existing good copy is reused');
  assert.match(src, /reused: true/);
});

// ── the review screen, as a staged workflow ─────────────────────────────────
//
// On the iPhone the first version put the whole payment section under a list
// where nothing was ready to pay for, hid the reason each phone was held up,
// printed IMEIs as an unlabelled column, and let "Exclude all 100" sit on top
// of the sentence explaining what to do. These keep the shape that replaced it.

const groupOf = (b: BatchState) => groupEntries(b)[0];

it('a group reports its own counts, subtotal and the reason it is held up', () => {
  const b = batchOf([
    entry({ key: 'a', problems: ['product_unknown'] }),
    entry({ key: 'b', problems: ['product_unknown'] }),
    entry({ key: 'c' }),
  ]);
  const summary = groupSummary(b, groupOf(b));
  assert.equal(summary.phones, 3);
  assert.equal(summary.needsAttention, 2);
  assert.equal(summary.ready, 1);
  assert.equal(summary.subtotal, 37500);
  assert.equal(summary.reason, 'product_unknown', 'one shared reason is named');
  assert.deepEqual(summary.matchableKeys, ['a', 'b'], 'one product choice would fix both');
});

it('a group whose phones are held up for different reasons names no single one', () => {
  const b = batchOf([
    entry({ key: 'a', problems: ['product_unknown'] }),
    entry({ key: 'b', problems: ['duplicate_in_stock'] }),
  ]);
  const summary = groupSummary(b, groupOf(b));
  assert.equal(summary.reason, null);
  assert.deepEqual(summary.matchableKeys, [], 'a duplicate is not fixed by choosing a product');
});

it('an excluded phone leaves the subtotal and is counted apart', () => {
  const b = batchOf([entry({ key: 'a' }), entry({ key: 'b' })]);
  b.excluded = ['b'];
  const summary = groupSummary(b, groupOf(b));
  assert.equal(summary.excluded, 1);
  assert.equal(summary.ready, 1);
  assert.equal(summary.subtotal, 12500, 'only what will actually be received');
});

it('a group-level match fixes exactly that group, and the counts follow at once', () => {
  const b = batchOf([
    entry({ key: 'a', problems: ['product_unknown'] }),
    entry({ key: 'b', problems: ['product_unknown'] }),
    // A different variant: its own group, and untouched by the first group's fix.
    entry({ key: 'c', problems: ['product_unknown'], extracted: { ...entry({ key: 'c' }).extracted, storage: '256' } }),
  ]);
  assert.equal(batchCounts(b).needsAttention, 3);

  const first = groupEntries(b).find((g) => g.variant?.startsWith('128'))!;
  for (const key of groupSummary(b, first).matchableKeys) b.corrections[key] = { productId: 'p7' };

  assert.equal(batchCounts(b).needsAttention, 1, 'only the other variant is still waiting');
  assert.equal(batchCounts(b).ready, 2);
  assert.equal(batchCounts(b).selectedCost, 25000, 'the total prices what is ready, not what is still held up');
  const other = groupEntries(b).find((g) => g.variant?.startsWith('256'))!;
  assert.equal(groupSummary(b, other).needsAttention, 1, 'the other group was not touched');
});

it('only products every phone in the group matched are offered for all of them', () => {
  const b = batchOf([entry({ key: 'a' }), entry({ key: 'b' })]);
  const p = (id: string) => ({ id, brand: 'Apple', model: 'iPhone 12', variant: null });
  b.parsed.matches.a = { productId: null, candidates: [p('p1'), p('p2')], exact: false };
  b.parsed.matches.b = { productId: null, candidates: [p('p2'), p('p3')], exact: false };
  assert.deepEqual(groupCandidates(b, groupOf(b)).map((c) => c.id), ['p2']);
});

it('two IMEIs are one phone, in the group count and in the total', () => {
  const b = batchOf([
    entry({ key: 'a', extracted: { ...entry({ key: 'a' }).extracted, imei2: '990001000000026' } }),
  ]);
  assert.equal(groupSummary(b, groupOf(b)).phones, 1);
  assert.equal(batchCounts(b).phones, 1);
  assert.equal(batchCounts(b).selectedCost, 12500, 'charged once, not once per identifier');
});

it('payment is out of reach until nothing is unresolved', () => {
  const b = batchOf([entry({ key: 'a' }), entry({ key: 'b', problems: ['product_unknown'] })]);
  assert.equal(reviewComplete(b), false);
  assert.equal(canConfirm(b), false);
  // Excluding it deliberately is a resolution too.
  b.excluded = ['b'];
  assert.equal(reviewComplete(b), true);
  assert.equal(canConfirm(b), true);
});

it('a delivery with nothing left in it may be finished reviewing, but not bought', () => {
  const b = batchOf([entry({ key: 'a', problems: ['duplicate_in_stock'] })]);
  b.excluded = ['a'];
  assert.equal(reviewComplete(b), true);
  assert.equal(canConfirm(b), false, 'there is nothing to pay for');
});

it('a bulk cost says how many already say something different', () => {
  const b = batchOf([
    entry({ key: 'a' }),
    entry({ key: 'b', extracted: { ...entry({ key: 'b' }).extracted, cost: 9000 } }),
    entry({ key: 'c', extracted: { ...entry({ key: 'c' }).extracted, cost: null } }),
  ]);
  const preview = previewBulkCost(b, ['a', 'b', 'c'], 12500);
  assert.equal(preview.affected, 3);
  assert.equal(preview.unchanged, 1, 'a already costs this');
  assert.equal(preview.differing, 1, 'b says 9000 — the person must be told');
});

// ── the screen itself ───────────────────────────────────────────────────────

it('the screen is staged: review, then payment, then confirm', () => {
  const src = code(read('../app/receive/file.tsx'));
  assert.match(src, /type Step = 'review' \| 'payment'/);
  assert.match(src, /step === 'payment'/, 'payment is a separate step');
  const paymentAt = src.indexOf("step === 'payment'");
  const pickerAt = src.indexOf('<PurchasePaymentPicker');
  assert.ok(paymentAt > 0 && pickerAt > paymentAt, 'the payment picker lives inside the payment step');
});

it('the review footer offers only Continue, and only once nothing is unresolved', () => {
  const src = code(read('../app/receive/file.tsx'));
  assert.match(src, /title=\{t\('fileReceive\.continue'\)\}/);
  assert.match(src, /disabled=\{!ready \|\| counts\.ready === 0\}/, 'blocked while anything needs attention');
  assert.match(src, /reviewComplete\(batch\)/, 'the gate is the shared rule, not a local guess');
  assert.match(src, /fileReceive\.footer\.ready/);
  assert.match(src, /fileReceive\.footer\.excluded/);
});

it('the summary is three figures with their words, and the one action addresses the actual problem', () => {
  const src = code(read('../app/receive/file.tsx'));
  assert.match(src, /<SummaryTile label=\{t\('fileReceive\.filter\.ready'\)\} value=\{counts\.ready\}/);
  assert.match(src, /<SummaryTile label=\{t\('fileReceive\.filter\.attention'\)\} value=\{counts\.needsAttention\}/);
  assert.match(src, /<SummaryTile label=\{t\('fileReceive\.filter\.excluded'\)\} value=\{counts\.excluded\}/);
  assert.match(src, /fileReceive\.matchProducts/, 'the primary action addresses the actual problem');
  assert.ok(!/position: 'absolute'/.test(src), 'nothing inside a card is positioned absolutely');
  // One row of filters that scrolls sideways — never a wrapping wall.
  assert.match(src, /<ScrollView horizontal[^>]*contentContainerStyle=\{styles\.filters\}/);
  assert.doesNotMatch(src, /filters: \{[^}]*flexWrap/);
});

it('a row says where it came from, which one it is (masked), what it costs and where it stands — in words', () => {
  const src = code(read('../app/receive/file.tsx'));
  const row = src.slice(src.indexOf('const EntryRow = React.memo'), src.indexOf('function Field('));
  assert.match(row, /t\('fileReceive\.row', \{ row: String\(source\.row \?\? ''\) \}\)/, 'the spreadsheet row');
  assert.match(row, /maskIdentifier\(identifier\)/, 'the identifier masked to its last four');
  assert.match(row, /identifierKind === 'serial' \? t\('fileReceive\.field\.serial'\) : t\('fileReceive\.field\.imei1'\)/, 'labelled by its kind, never a fake IMEI');
  assert.match(row, /t\('fileReceive\.twoImeis'\)/, 'a second IMEI is indicated, not printed as another phone');
  assert.match(row, /formatMoney\(cost\)/);
  assert.match(row, /tone=\{statusTone\}[\s\S]{0,80}\{status\}/, 'status in colour AND words');
  assert.doesNotMatch(row, /<InlineNotice/, 'no warning card repeated on every row');
  assert.doesNotMatch(src, /AlertTriangle/, 'no warning icon beside a value');
  assert.match(src, /ItemSeparatorComponent=\{Separator\}/, 'thin dividers between records');
});

it('Accept, Edit and Exclude carry their names, and Accept waits until nothing blocks the item', () => {
  const src = code(read('../app/receive/file.tsx'));
  const row = src.slice(src.indexOf('const EntryRow = React.memo'), src.indexOf('function Field('));
  assert.match(row, /title=\{t\('fileReceive\.action\.accept'\)\}[\s\S]{0,200}disabled=\{!acceptable\}/, 'Accept is named and disabled while a blocking issue remains');
  assert.match(row, /title=\{t\('fileReceive\.action\.edit'\)\}/);
  assert.match(row, /title=\{t\('fileReceive\.remove'\)\}/);
  assert.doesNotMatch(row, /<IconButton/, 'no unexplained icon boxes');
  // Accept confirms natively, naming the item, and marks it ready — nothing else.
  const accept = src.slice(src.indexOf('const acceptEntry'), src.indexOf('const removeEntry'));
  assert.match(accept, /canAccept\(live, entry\)/);
  assert.match(accept, /dialog\.confirm\(/);
  assert.match(accept, /fileReceive\.accept\.body/);
  assert.match(accept, /if \(ok\) setAcknowledged\(key, true\)/);
  // Exclude confirms destructively and removes only that row; restoring needs no confirmation.
  const exclude = src.slice(src.indexOf('const removeEntry'), src.indexOf('const editEntry'));
  assert.match(exclude, /tone: 'danger'/);
  assert.match(exclude, /if \(ok\) setExcluded\(key, true\)/);
  assert.match(exclude, /setExcluded\(key, false\);\s*return;/);
});

it('accepting, editing and excluding change the draft only — stock is created by the final confirmation alone', () => {
  const src = code(read('../app/receive/file.tsx'));
  const posts = src.match(/api\.post</g) ?? [];
  assert.equal(posts.length, 1, 'one request writes anything');
  assert.match(src, /api\.post<PurchaseOutcome>\('\/purchases'/);
  assert.doesNotMatch(src, /post\([^)]*(units|inventory|products)/);
});

it('the item sheet shows the whole identifiers, the source, the product, the cost and what blocks it, and returns to the same list', () => {
  const src = code(read('../app/receive/file.tsx'));
  const sheet = src.slice(src.indexOf('function ItemSheet('), src.indexOf('const useStyles'));
  assert.match(sheet, /value=\{entry\.extracted\.imei1\} identifier/, 'IMEI 1 whole');
  assert.match(sheet, /value=\{imei2\} identifier/, 'IMEI 2 whole');
  assert.match(sheet, /value=\{entry\.extracted\.serial\} identifier/, 'a serial whole');
  assert.match(sheet, /fileReceive\.field\.source/);
  assert.match(sheet, /fileReceive\.detail\.product/);
  assert.match(sheet, /fileReceive\.detail\.issue/);
  assert.match(sheet, /fileReceive\.field\.cost/);
  assert.match(sheet, /onAccept/); assert.match(sheet, /onExclude/); assert.match(sheet, /onSave\(\{ cost: Number\(cost\) \}\)/);
  // The sheet is keyed by the item and closes back onto the same list: the list itself is never remounted or scrolled.
  assert.match(src, /<ItemSheet\s+key=\{detailKey \?\? 'none'\}/);
  assert.doesNotMatch(src, /scrollToOffset|scrollToIndex|key=\{[^}]*\}\s*data=\{rows\}/);
});

it('every short status exists for every problem, in all three languages', () => {
  const problems = ['imei1_missing', 'imei1_invalid', 'imei1_rounded', 'imei2_invalid', 'imei2_same_as_imei1', 'imei2_rounded', 'model_missing', 'cost_missing', 'cost_invalid', 'duplicate_in_file', 'duplicate_in_stock', 'product_unknown', 'product_ambiguous', 'formula_value'];
  for (const locale of ['en', 'fr', 'ar']) {
    const cat = read(`./i18n/${locale}.ts`);
    for (const p of problems) {
      assert.ok(cat.includes(`'fileReceive.short.${p}':`), `${locale} is missing the short status for ${p}`);
      assert.ok(cat.includes(`'fileReceive.problem.${p}':`), `${locale} is missing the full sentence for ${p}`);
    }
  }
});

it('Exclude all left the warning and asks first, saying how many', () => {
  const src = code(read('../app/receive/file.tsx'));
  const tailAt = src.indexOf('ListFooterComponent');
  const excludeAt = src.indexOf("t('fileReceive.excludeAll'", tailAt);
  assert.ok(tailAt > 0 && excludeAt > tailAt, 'it sits at the end of the review, not in the alert');
  assert.match(src, /excludeAll\.title', \{ count: String\(attentionKeys\.length\) \}/);
  assert.match(src, /variant="tertiary"[\s\S]{0,120}excludeAll|excludeAll[\s\S]{0,160}variant="tertiary"/, 'it is not competing with the fix');
});

it('groups are collapsed first, and phones exist only while a group is open', () => {
  const src = code(read('../app/receive/file.tsx'));
  assert.match(src, /<FlatList/, 'the established list, not a mapped ScrollView');
  assert.match(src, /removeClippedSubviews/);
  // The rows of the open group are records in the same list — built by the
  // flattening rule, which is proved in file-review-rows.test.ts.
  assert.match(src, /reviewRows\(batch, groups, summaries, openKey, filter\)/, 'rows exist only for the open group');
  assert.match(src, /count=\{summary\.phones\}[\s\S]{0,80}subtotal=\{formatMoney\(summary\.subtotal\)\}/, 'a collapsed group shows its count and subtotal');
  assert.match(src, /fileReceive\.short\.\$\{summary\.reason\}/, 'and why it is held up, in a few words');
});

it('one group opens at a time, and changing the filter keeps the corrections and what was open', () => {
  const src = code(read('../app/receive/file.tsx'));
  // Single-open: opening a group closes whichever was open, so the mounted
  // rows never grow with the delivery.
  assert.match(src, /setOpenKey\(\(current\) => toggleOpenGroup\(current, key\)\)/, 'one group open at a time, by key');
  // The filter only chooses what to show; it never touches the batch or collapses the open group.
  const filterAt = src.indexOf('setFilter(');
  assert.ok(filterAt > 0);
  assert.ok(!/setFilter\([^)]*\);\s*(clear|setOpenKey)\(/.test(src), 'filtering clears nothing');
});

it('the bulk edit says which field it changes, and is named plainly', () => {
  const src = code(read('../app/receive/file.tsx'));
  assert.match(src, /fileReceive\.bulk\.fields/, 'it lists what can be changed');
  assert.match(src, /previewBulkCost\(batch, keys, value\)/);
  assert.match(src, /bulkCost\.bodyDiffering/, 'differing values are stated before they are overwritten');
});

it('every string the review screen uses exists in all three languages', () => {
  const src = read('../app/receive/file.tsx');
  const keys = [...src.matchAll(/t\('((?:fileReceive|action|home)\.[A-Za-z0-9.]+)'/g)].map((m) => m[1]);
  assert.ok(keys.length > 30, `expected the screen's keys, found ${keys.length}`);
  for (const locale of ['en', 'fr', 'ar']) {
    const cat = read(`./i18n/${locale}.ts`);
    for (const key of new Set(keys)) assert.ok(cat.includes(`'${key}':`), `${locale} is missing ${key}`);
  }
});

console.log(`file receiving: ${passed} passed`);
