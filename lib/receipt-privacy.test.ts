/**
 * What the customer's copy may never carry.
 *
 *   node lib/receipt-privacy.test.ts
 *
 * The private summary on Quick Sell shows a seller the purchase cost, how long
 * the phone sat on the shelf and what the shop stands to make. None of that may
 * reach the customer — not on the printed receipt, not in a shared file, not in
 * anything the share sheet hands to another app.
 *
 * Read from source, because this is a guarantee about SHAPE. A rendered receipt
 * that happens to omit cost today proves nothing about the one rendered after
 * somebody adds a field; a receipt type with nowhere to put cost does.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0;
const it = (name: string, fn: () => void) => {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`✗ ${name}`);
    throw e;
  }
};

// Line endings normalised: a Windows checkout (core.autocrlf) carries CRLF, and the slices below end on LF.
const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/** The document builder — the one generator behind every share and print. */
const RECEIPT = read('./receipt-html.ts');
const QUICK_SELL = read('../app/quick-sell.tsx');

/** The `ReceiptData` interface body — the only thing that reaches a customer. */
const RECEIPT_TYPE = (() => {
  const start = RECEIPT.indexOf('export interface ReceiptData {');
  const end = RECEIPT.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start, 'ReceiptData not found');
  return RECEIPT.slice(start, end);
})();

// ── The type itself ─────────────────────────────────────────────────────────

it('ReceiptData has no cost, margin or profit field at all', () => {
  // Not "is not currently populated" — has nowhere to put it.
  for (const financial of ['cost', 'margin', 'profit', 'cogs', 'unitCost']) {
    assert.equal(
      RECEIPT_TYPE.toLowerCase().includes(financial.toLowerCase()),
      false,
      `ReceiptData must not carry ${financial}`,
    );
  }
});

it('a receipt line carries a selling price and nothing behind it', () => {
  const start = RECEIPT.indexOf('interface ReceiptLine');
  const end = RECEIPT.indexOf('\n}', start);
  const line = RECEIPT.slice(start, end);
  assert.ok(line.includes('unitPrice'), 'the customer is told what they paid');
  assert.equal(line.includes('cost'), false, 'and never what the shop paid');
});

// ── What the rendered document may contain ──────────────────────────────────

it('the printed receipt never renders a cost or margin', () => {
  /*
   * `buildReceiptHtml` is what goes to the printer and into the shared file.
   *
   * Checked against what is actually PRINTED — every `${...}` interpolation —
   * rather than against the source text. The first version of this test
   * searched the whole function for "margin" and failed on the CSS property
   * `margin:` in the receipt's own stylesheet: a false alarm that would have
   * taught the next person to loosen the assertion rather than trust it.
   */
  const start = RECEIPT.indexOf('export function buildReceiptHtml');
  assert.ok(start >= 0, 'the builder was not found');
  const html = RECEIPT.slice(start);
  const printed = html.match(/\$\{[^}]*\}/g) ?? [];
  assert.ok(printed.length > 0, 'the receipt builder should interpolate something');
  for (const expr of printed) {
    for (const financial of ['cost', 'margin', 'profit', 'cogs']) {
      assert.equal(
        expr.toLowerCase().includes(financial),
        false,
        `the receipt must not print ${financial} — found in ${expr}`,
      );
    }
  }
});

// ── The Quick Sell screen that builds it ────────────────────────────────────

it('the share wrapper adds nothing of its own to the document', () => {
  // One generator. `receipt.ts` may only feed it language and formatters.
  const wrapper = read('./receipt.ts');
  assert.ok(wrapper.includes("from './receipt-html'"), 'the wrapper must use the one builder');
  assert.equal(wrapper.includes('<html'), false, 'no second HTML template may exist');
  // "margins" is the page's, and legitimately here; the shop's margin is not.
  for (const financial of ['cost', 'profit', 'cogs']) {
    assert.equal(wrapper.toLowerCase().includes(financial), false, `the wrapper must not mention ${financial}`);
  }
});

it('Quick Sell builds the receipt without passing cost or profit into it', () => {
  const start = QUICK_SELL.indexOf('const receipt: ReceiptData = {');
  const end = QUICK_SELL.indexOf('};', start);
  assert.ok(start >= 0 && end > start, 'the receipt construction was not found');
  const built = QUICK_SELL.slice(start, end);
  for (const financial of ['cost', 'margin', 'expected', 'daysInStock']) {
    assert.equal(
      built.includes(financial),
      false,
      `the customer's receipt must not be built with ${financial}`,
    );
  }
});

it('Quick Sell shows the private summary only behind cost.view', () => {
  // The server strips `cost` without the permission, but the screen must not
  // render a row that reads as "this phone was free" when it does.
  assert.ok(
    QUICK_SELL.includes('canViewCost && picked.selection.cost !== undefined'),
    'the cost row must be gated on the permission AND on the field being present',
  );
});

it('Quick Sell shows a loss as a loss rather than flooring it at zero', () => {
  assert.ok(
    QUICK_SELL.includes("expected < 0 ? t('quick.sell.expected.loss')"),
    'a negative expected result must be labelled as a loss',
  );
});

it('the private summary says out loud that it is private', () => {
  assert.ok(QUICK_SELL.includes("t('quick.sell.private')"));
});

// ── Idempotency, which protects the customer's money ────────────────────────

it('the sale key is one per sale, not one per attempt', () => {
  /*
   * A key regenerated per request turns a timeout retry into a second sale — a
   * customer charged twice for one phone. It is renewed only when a NEW sale
   * is started from the success screen.
   */
  assert.ok(QUICK_SELL.includes('const clientUuid = useRef(uuidv4())'));
  assert.ok(
    QUICK_SELL.includes('clientUuid.current = uuidv4()'),
    'a new sale must take a new key',
  );
  const attempt = QUICK_SELL.slice(QUICK_SELL.indexOf('const attempt = async'));
  assert.equal(
    attempt.slice(0, attempt.indexOf('catch')).includes('uuidv4()'),
    false,
    'the key must not be regenerated inside a submission attempt',
  );
});

// ── The payer number (D151) stays off the customer's copy ───────────────────

it('the payer number never reaches the receipt: no field for it, no generator line, no builder passes it', () => {
  // The type has nowhere to put it, and the one generator never names it.
  const paymentType = RECEIPT.slice(RECEIPT.indexOf('export interface ReceiptPayment {'), RECEIPT.indexOf('\n}', RECEIPT.indexOf('export interface ReceiptPayment {')));
  assert.ok(paymentType.length > 0, 'ReceiptPayment not found');
  for (const text of [RECEIPT_TYPE, paymentType, RECEIPT]) assert.equal(/payer/i.test(text), false, 'the receipt must not carry a payer number');

  // The three places a receipt is built from payments copy fields one by one — and the payer number is not among them.
  const receiptPayments = (src: string, name: string) => {
    const start = src.indexOf('payments: payments.map((p) => ({');
    const end = src.indexOf('returnPolicy: sale.returnPolicy,', start);
    assert.ok(start >= 0 && end > start, `${name}: the receipt's payments not found`);
    return src.slice(start, end);
  };
  const SELL = read('../app/(tabs)/sell.tsx');
  const DETAIL = read('../app/sales/[id].tsx');
  const detailReceipt = DETAIL.slice(DETAIL.indexOf('function receiptOf'), DETAIL.indexOf('\n}\n', DETAIL.indexOf('function receiptOf')));
  assert.ok(detailReceipt.length > 0, 'receiptOf not found');
  for (const [name, region] of [
    ['sell', receiptPayments(SELL, 'sell')],
    ['quick sell', receiptPayments(QUICK_SELL, 'quick sell')],
    ['sale detail', detailReceipt],
  ] as const) {
    assert.equal(/payer/i.test(region), false, `${name}: the receipt is built without the payer number`);
  }
  // …while the request a few lines further on does send it: the absence above is a choice, not an oversight.
  assert.ok(SELL.indexOf('payerNumber: p.payerNumber') > SELL.indexOf('returnPolicy: sale.returnPolicy,'), 'sell sends it in the request, after the receipt');
});

console.log(`receipt-privacy: ${passed} passed`);
