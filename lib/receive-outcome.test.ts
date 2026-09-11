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
  const intake = withoutComments(source('app/receive.tsx'));
  assert.match(intake, /const barcode = result && result\.kind === 'barcode' \? result\.code : null;/);
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
  assert.match(screen, /clientUuid,\s*supplierId/);
});

it('returns from Create product to the same Receive screen with the created product', () => {
  const create = withoutComments(source('app/catalog/new.tsx'));
  assert.match(create, /notePendingProduct\(product\.id\);\s*if \(router\.canGoBack\(\)\) router\.back\(\);/);
  const screen = withoutComments(source('app/receive.tsx'));
  assert.match(screen, /back\.createdProductId/);
  assert.match(screen, /\/products\/suggest\?productId=/);
});

console.log(`receive outcome: ${passed} passed`);
