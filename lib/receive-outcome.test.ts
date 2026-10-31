/**
 * Receiving outcomes, IMEI 2 and retry safety — proved without a screen.
 *
 *   node lib/receive-outcome.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  codesInDelivery,
  imei2Problem,
  purchaseItems,
  settle,
  draftKey,
  withSecondary,
  type ReceiveLine,
} from './receive-outcome.ts';
import { scanHintKey } from './scan/hint.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`FAIL  ${name}`);
    throw e;
  }
};
const source = (p: string) => readFileSync(p, 'utf8');
const withoutComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const imei = (body14: string) => {
  let s = 0;
  for (let i = 0; i < 14; i++) {
    let d = Number(body14[i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    s += d;
  }
  return body14 + ((10 - (s % 10)) % 10);
};
const A1 = imei('35000000000001');
const A2 = imei('35000000000002');
const B1 = imei('35000000000003');

const phones: ReceiveLine = {
  key: 'p',
  productId: 'PHONE',
  trackingType: 'imei',
  unitCost: 800,
  identifiers: [A1, B1],
  secondaries: { [A1]: A2 },
};
const cables: ReceiveLine = { key: 'c', productId: 'CABLE', trackingType: 'quantity', unitCost: 5, quantity: 10 };

/* ── what is sent ───────────────────────────────────────────────────────── */

it('sends each phone with its IMEI 2 when it has one, and alone when not', () => {
  assert.deepEqual(purchaseItems([phones, cables]), [
    { productId: 'PHONE', unitCost: 800, units: [{ identifier: A1, imeiSecondary: A2 }, { identifier: B1 }] },
    { productId: 'CABLE', unitCost: 5, quantity: 10 },
  ]);
});

it('never sends an IMEI as a product barcode', () => {
  assert.ok(!JSON.stringify(purchaseItems([phones])).includes('barcode'));
  // D223: the code is a barcode only when the person said it names the product model…
  for (const file of ['app/receive.tsx', 'app/quick-receive.tsx']) {
    const intake = withoutComments(source(file));
    assert.match(intake, /const barcode = answer\.field === 'productBarcode' \? result\.code : null;/, file);
  }
  // …and an IMEI is never asked that question: it can only answer `imei`.
  const ask = withoutComments(source('lib/scan/ask-intake.ts'));
  const imeiBranch = ask.slice(ask.indexOf("if (result.kind === 'imei')"), ask.indexOf('const choice = await dialog.choose({\n    title: t(\'intake.identity.title\')'));
  assert.doesNotMatch(imeiBranch, /productBarcode/);
  assert.match(imeiBranch, /field: 'imei'/);
});

/* ── what the answer means ──────────────────────────────────────────────── */

it('all received: nothing remains, counts come from the server', () => {
  const s = settle([phones, cables], {
    purchaseId: 'x', unitsCreated: 2, stockLines: 1, total: 1650,
    accepted: { identifiers: [A1, B1], stockProductIds: ['CABLE'] },
  });
  assert.equal(s.outcome, 'all');
  assert.deepEqual(s.remaining, []);
  assert.equal(s.receivedUnits, 2);
  assert.equal(s.receivedPieces, 10);
});

it('all refused: everything stays, nothing counted', () => {
  const s = settle([phones, cables], {
    purchaseId: null, unitsCreated: 0, stockLines: 0, total: 0,
    rejected: [{ identifier: A1, reason: 'already registered', secondary: A2 }],
  });
  assert.equal(s.outcome, 'none');
  assert.equal(s.remaining.length, 2);
  assert.equal(s.receivedUnits + s.receivedPieces, 0);
});

it('partly received: only refused phones remain, with their IMEI 2', () => {
  const s = settle([phones, cables], {
    purchaseId: 'x', unitsCreated: 1, stockLines: 1, total: 850,
    rejected: [{ identifier: A1, reason: 'already registered', secondary: A2 }],
    accepted: { identifiers: [B1], stockProductIds: ['CABLE'] },
  });
  assert.equal(s.outcome, 'partial');
  assert.deepEqual(s.remaining, [{ ...phones, identifiers: [A1], secondaries: { [A1]: A2 } }]);
  assert.equal(s.receivedUnits, 1);
  assert.equal(s.receivedPieces, 10);
});

it('retrying the remainder can never resend an accepted line', () => {
  const first = settle([phones, cables], {
    purchaseId: 'x', unitsCreated: 1, stockLines: 1, total: 850,
    accepted: { identifiers: [B1], stockProductIds: ['CABLE'] },
    rejected: [{ identifier: A1, reason: 'already registered' }],
  });
  const resend = JSON.stringify(purchaseItems(first.remaining));
  assert.ok(!resend.includes(B1));
  assert.ok(!resend.includes('CABLE'));
});

it('a replayed answer after a lost response settles exactly like the original', () => {
  const original = { purchaseId: 'x', unitsCreated: 2, stockLines: 1, total: 1650, accepted: { identifiers: [A1, B1], stockProductIds: ['CABLE'] } };
  assert.deepEqual(settle([phones, cables], { ...original, rejected: [], replayed: true }), settle([phones, cables], original));
});

it('an older server without `accepted` is read conservatively', () => {
  const s = settle([phones], { purchaseId: 'x', unitsCreated: 1, stockLines: 0, total: 800, rejected: [{ identifier: A1, reason: 'already registered' }] });
  assert.deepEqual(s.remaining.map((l) => l.identifiers), [[A1]]);
});

/* ── IMEI 2 ─────────────────────────────────────────────────────────────── */

it('IMEI 2 is optional', () => {
  assert.equal(imei2Problem(A1, '', [phones]), null);
});

it('refuses an invalid IMEI 2, IMEI 1 again, and a number already in the delivery', () => {
  assert.equal(imei2Problem(B1, '123456789012345', [phones]), 'invalid');
  assert.equal(imei2Problem(B1, B1, []), 'same');
  assert.equal(imei2Problem(B1, A2, [phones]), 'inDelivery');
  assert.equal(imei2Problem(B1, A1, [phones]), 'inDelivery');
});

it('knows every number in the delivery, IMEI 1 and IMEI 2 alike', () => {
  assert.deepEqual([...codesInDelivery([phones])].sort(), [A1, A2, B1].sort());
});

it('attaches an IMEI 2 to one phone without touching the others', () => {
  const next = withSecondary([phones], 'p', B1, imei('35000000000009'));
  assert.equal(next[0].secondaries?.[A1], A2);
  assert.equal(next[0].secondaries?.[B1], imei('35000000000009'));
});

/* ── hints ──────────────────────────────────────────────────────────────── */

it('maps every server hint code to a key present in all three languages', () => {
  const codes = ['unrecognized_code', 'new_barcode', 'recognized_device', 'unknown_imei', 'serial_manual', 'contested_mapping'];
  for (const lang of ['en', 'fr', 'ar']) {
    const locale = source(`lib/i18n/${lang}.ts`);
    for (const code of codes) {
      const key = scanHintKey(code);
      assert.ok(key && locale.includes(`'${key}'`), `${lang} is missing ${key}`);
    }
  }
  assert.equal(scanHintKey('something_new'), null);
});

it('the confirmation card never shows the English server hint', () => {
  const card = withoutComments(source('components/product/ProductConfirmationCard.tsx'));
  assert.ok(!/result\.hint\b/.test(card), 'result.hint must not be rendered');
  assert.match(card, /scanHintKey\(result\.hintCode\)/);
});

it('the unknown-IMEI copy keeps the IMEI with the phone, not the product', () => {
  for (const lang of ['en', 'fr', 'ar']) {
    const line = source(`lib/i18n/${lang}.ts`).split('\n').find((l) => l.includes("'scan.hint.unknownImei'")) ?? '';
    assert.ok(!/barcode|code-barres|باركود/i.test(line), `${lang}: must not call the IMEI a barcode`);
  }
});

/* ── the screen keeps its promises ──────────────────────────────────────── */

it('checks both IMEIs against stock before cost is asked', () => {
  const screen = withoutComments(source('app/receive.tsx'));
  assert.match(screen, /result\.inventory\?\.alreadyInInventory/);
  assert.match(screen, /api\.post<ScanResult>\('\/scan', \{ code[^}]*secondary/);
});

it('keeps the request key across an uncertain attempt and renews it only after a confirmed answer', () => {
  const screen = withoutComments(source('app/receive.tsx'));
  assert.match(screen, /setUncertain\(true\)/);
  assert.match(screen, /outcome === 'partial'[\s\S]*?setClientUuid\(uuidv4\(\)\)/);
  assert.match(screen, /clientUuid,\s*\.\.\.purchasePaymentBody\(payment\)/);
});

it('asks no supplier and no amount paid — only how the purchase was paid', () => {
  for (const file of ['app/receive.tsx', 'app/quick-receive.tsx']) {
    const screen = withoutComments(source(file));
    assert.doesNotMatch(screen, /supplier/i, `${file} must not mention a supplier`);
    assert.doesNotMatch(screen, /paidAmount|paidInFull|dueDate/, `${file} must not ask what was paid`);
    assert.match(screen, /<PurchasePaymentPicker value=\{payment\} onChange=\{setPayment\} \/>/);
    assert.match(screen, /disabled=\{!purchasePaymentReady\(payment\)( \|\| add\.isPending)?\}/);
  }
});

it('a non-cash purchase is not ready until an account is chosen', async () => {
  const picker = withoutComments(source('components/receive/PurchasePaymentPicker.tsx'));
  assert.match(picker, /p\.method === 'cash' \|\| Boolean\(p\.receivingAccountId\)/);
  assert.match(picker, /paymentMethod: p\.method/);
  assert.match(picker, /\.filter\(\(a\) => a\.isActive !== false\)/, 'a deactivated account is never offered');
  assert.doesNotMatch(picker, /amount/i);
});

it('Create product never hands a product or a draft back to a Receive screen (D226)', () => {
  // The hand-back had no cost field and failed during the return (the 2026-10-30 mouse crash).
  const create = withoutComments(source('app/catalog/new.tsx'));
  assert.doesNotMatch(create, /notePendingProduct|notePendingDraft|handBack|forDelivery/);
  for (const file of ['app/receive.tsx', 'app/quick-receive.tsx']) {
    assert.match(withoutComments(source(file)), /return \{ intake: 'quick', \.\.\.\(barcode/, `${file} opens the single-item intake`);
  }
});

// ── D223: a product created by the intake, in the same request ─────────────
const draft = { brand: 'Fictiva', model: 'Test Phone 1', variant: '128GB Grey', trackingType: 'imei' as const };

it('sends a new product in place of a product id, never both', () => {
  const [item] = purchaseItems([
    { key: 'a', productId: '', newProduct: draft, trackingType: 'imei', unitCost: 900, identifiers: ['490154203237518'] },
  ]);
  assert.deepEqual(item.newProduct, draft);
  assert.equal('productId' in item, false);
  const [existing] = purchaseItems([{ key: 'b', productId: 'p-1', trackingType: 'quantity', unitCost: 5, quantity: 2 }]);
  assert.equal(existing.productId, 'p-1');
  assert.equal('newProduct' in existing, false);
});

it('files a line left for correction under the product the server just created', () => {
  const sent = [
    { key: 'a', productId: '', newProduct: draft, trackingType: 'imei' as const, unitCost: 900, identifiers: ['490154203237518', '356938035643809'] },
  ];
  const result = settle(sent, {
    purchaseId: 'pu-1', unitsCreated: 1, stockLines: 0, total: 900,
    rejected: [{ identifier: '356938035643809', reason: 'already registered' }],
    accepted: { identifiers: ['490154203237518'], stockProductIds: [] },
    createdProducts: [{ productId: 'new-1', brand: 'Fictiva', model: 'Test Phone 1', variant: '128GB Grey' }],
  });
  assert.equal(result.outcome, 'partial');
  assert.equal(result.remaining[0].productId, 'new-1');
  assert.equal(result.remaining[0].newProduct, undefined);
});

it('keeps the draft when nothing was received, so nothing was created', () => {
  const sent = [{ key: 'a', productId: '', newProduct: draft, trackingType: 'imei' as const, unitCost: 900, identifiers: ['490154203237518'] }];
  const result = settle(sent, { purchaseId: null, unitsCreated: 0, stockLines: 0, total: 0, createdProducts: [] });
  assert.equal(result.outcome, 'none');
  assert.deepEqual(result.remaining[0].newProduct, draft);
});

it('compares drafts as the server does: case and spacing', () => {
  assert.equal(draftKey({ brand: ' fictiva', model: 'TEST phone 1 ' }), draftKey({ brand: 'Fictiva', model: 'Test Phone 1', variant: '' }));
});

it('a product made from a scan is saved only with its stock, and success is said only after the commit (D223)', () => {
  const create = withoutComments(source('app/catalog/new.tsx'));
  // From either Receive screen (D226): ONE purchase creates the product with its stock, here.
  const receive = create.slice(create.indexOf('const receive = useMutation'), create.indexOf('const commitQuick'));
  assert.match(receive, /api\.post<PurchaseOutcome>\('\/purchases'/);
  assert.match(receive.slice(receive.indexOf('onSuccess:'), receive.indexOf('onError:')), /receive\.createdAndAdded/);
  assert.match(receive, /e\.code === 'product_exists'/);
  for (const file of ['app/quick-receive.tsx', 'app/receive.tsx']) {
    const screen = withoutComments(source(file));
    const ok = screen.slice(screen.indexOf('onSuccess:'), screen.indexOf('onError:'));
    assert.match(ok, /receive\.createdAndAdded/, `${file} says "created and added" only in onSuccess`);
    assert.match(screen, /e\.code === 'product_exists'/, `${file} handles a product created meanwhile`);
  }
});

console.log(`receive outcome: ${passed} passed`);
