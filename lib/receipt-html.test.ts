/**
 * The customer's invoice, as a document.
 *
 *   node lib/receipt-html.test.ts
 *
 * Built under bare `node` from the same builder the app prints with, in the
 * three languages, from the three catalogues. What is pinned: everything the
 * brief says an invoice carries is on it, everything it says must never reach a
 * customer is not, every value is escaped, and the page rules that keep a long
 * invoice readable are in the stylesheet.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildReceiptHtml,
  esc,
  receiptLabels,
  receiptPayStatus,
  RECEIPT_LABEL_KEYS,
  type ReceiptContext,
  type ReceiptData,
} from './receipt-html.ts';
import { en } from './i18n/en.ts';
import { fr } from './i18n/fr.ts';
import { ar } from './i18n/ar.ts';
import { formatMoney } from './money-format.ts';

type Lang = 'en' | 'fr' | 'ar';
const DICT = { en, fr, ar } as const;
const dateTime = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ');

function ctx(lang: Lang = 'en', policyLine = 'Returnable within 7 days — until 2026-09-29'): ReceiptContext {
  const dict = DICT[lang] as Record<string, string>;
  return {
    labels: receiptLabels((key) => dict[key]),
    lang,
    rtl: lang === 'ar',
    formatMoney,
    formatDateTime: dateTime,
    policyLine,
  };
}

const SOLD_AT = new Date('2026-09-22T10:15:00.000Z');
const IMEI = '356789012345678';

const base = (over: Partial<ReceiptData> = {}): ReceiptData => ({
  invoiceNo: 'INV-2026-000123',
  soldAt: SOLD_AT,
  storeName: 'Nouakchott Phones',
  branchName: 'Main Store',
  cashierName: 'Amina',
  customer: null,
  lines: [{ label: 'iPhone 13', variant: '128 GB · Blue', identifier: IMEI, quantity: 1, unitPrice: 245_000 }],
  subtotal: 245_000,
  discount: 0,
  total: 245_000,
  amountPaid: 245_000,
  balanceDue: 0,
  payStatus: 'paid',
  payments: [{ method: 'Cash', amount: 245_000, kind: 'at_sale', paidAt: SOLD_AT }],
  returnPolicy: { windowHours: 168, deadlineAt: '2026-09-29T10:15:00.000Z' },
  ...over,
});

const bodyOf = (html: string) => html.slice(html.indexOf('<body>'));
const rowsOf = (html: string) => (bodyOf(html).match(/<tr>\s*<td class="name">/g) ?? []).length;

describe('one serialized item', () => {
  const html = buildReceiptHtml(base(), ctx());

  it('names the store, the branch, the invoice, the date and who served', () => {
    const body = bodyOf(html);
    assert.match(body, /<h1>Nouakchott Phones<\/h1>/);
    assert.match(body, /Branch: Main Store/);
    assert.match(body, /INV-2026-000123/);
    assert.ok(body.includes(dateTime(SOLD_AT)));
    assert.match(body, /Served by[\s\S]*Amina/);
  });

  it('prints the item, its exact variant and the whole IMEI — the warranty proof', () => {
    const body = bodyOf(html);
    assert.match(body, /class="label">iPhone 13</);
    assert.match(body, /class="variant">128 GB · Blue</);
    assert.match(body, new RegExp(`class="id">${IMEI}<`));
    assert.equal(rowsOf(html), 1);
  });

  it('states the status in words and money in MRU', () => {
    const body = bodyOf(html);
    assert.match(body, /class="status status-paid">Paid</);
    assert.ok(body.includes(esc(formatMoney(245_000))), 'the total is formatted by the one money formatter');
    assert.match(body, /MRU/);
    assert.doesNotMatch(body, /class="row owed"/, 'nothing is owed');
  });

  it('says it is a cash customer when nobody was named', () => {
    assert.match(bodyOf(html), /Cash customer/);
  });
});

describe('one counted item', () => {
  const html = buildReceiptHtml(
    base({
      lines: [{ label: 'USB-C cable 1m', quantity: 10, unitPrice: 1_500 }],
      subtotal: 15_000,
      total: 15_000,
      amountPaid: 15_000,
      payments: [{ method: 'Cash', amount: 15_000 }],
    }),
    ctx(),
  );

  it('shows the quantity and the line total, and no identifier line', () => {
    const body = bodyOf(html);
    assert.match(body, /<td class="num">10<\/td>/);
    assert.ok(body.includes(esc(formatMoney(15_000, { showCurrency: false }))));
    assert.doesNotMatch(body, /class="id"/);
  });
});

describe('many items', () => {
  const lines = Array.from({ length: 12 }, (_, i) => ({
    label: `Item ${i + 1}`,
    identifier: i % 2 === 0 ? `35000000000${String(i).padStart(4, '0')}` : null,
    quantity: 1,
    unitPrice: 10_000,
  }));
  const html = buildReceiptHtml(base({ lines, subtotal: 120_000, total: 120_000, amountPaid: 120_000 }), ctx());

  it('prints every row once', () => {
    assert.equal(rowsOf(html), 12);
  });

  it('repeats the table header on each printed page and never splits a row or the totals', () => {
    assert.match(html, /thead \{ display: table-header-group; \}/);
    assert.match(html, /tr \{ break-inside: avoid; page-break-inside: avoid; \}/);
    assert.match(html, /\.totals \{[^}]*break-inside: avoid/);
    assert.match(html, /footer \{[^}]*break-inside: avoid/);
  });

  it('keeps one table header, not one per row', () => {
    assert.equal((html.match(/<thead>/g) ?? []).length, 1);
  });
});

describe('long names', () => {
  const long = 'Samsung Galaxy S24 Ultra 5G Dual SIM Titanium Gray 512 GB 12 GB RAM ' .repeat(5).trim();
  const html = buildReceiptHtml(base({ lines: [{ label: long, quantity: 1, unitPrice: 1 }], storeName: long }), ctx());

  it('prints them whole and lets them wrap instead of clipping', () => {
    assert.ok(bodyOf(html).includes(esc(long)));
    assert.match(html, /\.name \.label \{[^}]*overflow-wrap: anywhere/);
    assert.match(html, /h1 \{[^}]*overflow-wrap: anywhere/);
  });
});

describe('paid, partly paid, unpaid', () => {
  it('a partly paid sale shows what was paid, what remains, and who owes it', () => {
    const html = buildReceiptHtml(
      base({
        amountPaid: 100_000,
        balanceDue: 145_000,
        payStatus: 'partial',
        payments: [{ method: 'Cash', amount: 100_000, kind: 'at_sale', paidAt: SOLD_AT }],
        debtor: { kind: 'customer', name: 'Moussa Ba', phone: '+22233445566' },
      }),
      ctx(),
    );
    const body = bodyOf(html);
    assert.match(body, /class="status status-partial">Partially paid</);
    assert.match(body, new RegExp(`Paid</span><span class="figure">${esc(formatMoney(100_000))}`));
    assert.match(body, new RegExp(`class="row owed"><span>Remaining</span><span class="figure">${esc(formatMoney(145_000))}`));
    assert.match(body, /Balance owed by<\/div>\s*<div class="value">Moussa Ba</);
    assert.match(body, /\+22233445566/);
  });

  it('an unpaid sale says so, and a partner store is named as the one who owes', () => {
    const html = buildReceiptHtml(
      base({
        amountPaid: 0,
        balanceDue: 245_000,
        payStatus: 'unpaid',
        payments: [],
        debtor: { kind: 'store', name: 'Tevragh Zeina Mobile', phone: null },
      }),
      ctx(),
    );
    const body = bodyOf(html);
    assert.match(body, /class="status status-unpaid">Unpaid</);
    assert.match(body, /Balance owed by partner store<\/div>\s*<div class="value">Tevragh Zeina Mobile</);
    assert.doesNotMatch(body, /class="block payments"/, 'no payment block when nothing was paid');
  });

  it('derives the status from the money only when the server did not say', () => {
    assert.equal(receiptPayStatus({ payStatus: 'partial', total: 10, amountPaid: 10, balanceDue: 0 }), 'partial');
    assert.equal(receiptPayStatus({ total: 10, amountPaid: 4, balanceDue: 6 }), 'partial');
    assert.equal(receiptPayStatus({ total: 10, amountPaid: 0, balanceDue: 10 }), 'unpaid');
    assert.equal(receiptPayStatus({ total: 10, amountPaid: 10, balanceDue: 0 }), 'paid');
  });
});

describe('several payment methods', () => {
  const later = new Date('2026-09-25T16:40:00.000Z');
  const html = buildReceiptHtml(
    base({
      amountPaid: 245_000,
      payments: [
        { method: 'Cash', amount: 150_000, kind: 'at_sale', paidAt: SOLD_AT },
        { method: 'Mobile money', account: 'Bankily · 4411', amount: 95_000, kind: 'collection', paidAt: later },
      ],
    }),
    ctx(),
  );

  it('lists each payment with its method, its account as it was labelled, and when a later one arrived', () => {
    const body = bodyOf(html);
    assert.match(body, new RegExp(`<span>Cash</span>\\s*<span class="figure">${esc(formatMoney(150_000))}`));
    assert.match(body, new RegExp(`<span>Mobile money · Bankily · 4411 · on <span class="ltr">${dateTime(later)}</span></span>`));
    assert.doesNotMatch(body, new RegExp(`Cash · on`), 'money taken with the sale carries no separate date');
  });
});

describe('what must never reach the customer', () => {
  it('escapes every value that came from typing', () => {
    const html = buildReceiptHtml(
      base({
        storeName: 'Shop & "Co" <b>',
        cashierName: "O'Neil <i>",
        customer: { name: '<script>alert(1)</script>', phone: '<img src=x>' },
        lines: [{ label: '<script>alert(2)</script>', variant: '"x"', identifier: '<b>1</b>', quantity: 1, unitPrice: 1 }],
        payments: [{ method: '<svg/onload=1>', amount: 1, account: '<a href="x">' }],
        invoiceNo: '<i>',
      }),
      ctx('en', '<u>policy</u>'),
    );
    const body = bodyOf(html);
    assert.doesNotMatch(body, /<script|<img|<svg|<b>|<i>|<u>|<a href/);
    assert.match(body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(body, /Shop &amp; &quot;Co&quot; &lt;b&gt;/);
    assert.match(body, /O&#39;Neil/);
  });

  it('has nowhere to put cost, margin or an internal id — and prints none if handed one', () => {
    const smuggled = {
      ...base(),
      cost: 123_456.78,
      margin: 98_765.43,
      id: '018f0000-0000-7000-8000-00000000c001',
      lines: [{ ...base().lines[0], cost: 111_222.33, unitId: '018f0000-0000-7000-8000-00000000d001' }],
    } as unknown as ReceiptData;
    const html = buildReceiptHtml(smuggled, ctx());
    for (const banned of ['123 456', '98 765', '111 222', '018f0000', 'cost', 'margin', 'unitId']) {
      assert.equal(bodyOf(html).includes(banned), false, `the invoice must not carry ${banned}`);
    }
    assert.doesNotMatch(bodyOf(html), /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  });

  it('never claims a provider verified a payment', () => {
    const html = buildReceiptHtml(base(), ctx());
    assert.doesNotMatch(html, /verified|vérifié|confirmé par/i);
  });

  it('takes the return wording from the sale, and hardcodes none', () => {
    const html = buildReceiptHtml(base(), ctx('en', 'THE-POLICY-SENTENCE'));
    assert.match(bodyOf(html), /class="policy">THE-POLICY-SENTENCE</);
    const source = readFileSync(new URL('./receipt-html.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /no returns?|final sale|definitive/i);
  });
});

describe('three languages, two directions', () => {
  it('English and French read left to right; Arabic reads right to left', () => {
    assert.match(buildReceiptHtml(base(), ctx('en')), /<html lang="en" dir="ltr">/);
    assert.match(buildReceiptHtml(base(), ctx('fr')), /<html lang="fr" dir="ltr">/);
    assert.match(buildReceiptHtml(base(), ctx('ar')), /<html lang="ar" dir="rtl">/);
  });

  it('prints each catalogue’s own words, translated and not copied', () => {
    const partial = base({ amountPaid: 1, balanceDue: 244_999, payStatus: 'partial' });
    assert.match(bodyOf(buildReceiptHtml(partial, ctx('en'))), /Partially paid/);
    assert.match(bodyOf(buildReceiptHtml(partial, ctx('fr'))), /Partiellement payée/);
    assert.match(bodyOf(buildReceiptHtml(partial, ctx('ar'))), /مدفوعة جزئيًا/);

    for (const lang of ['en', 'fr', 'ar'] as const) {
      const labels = receiptLabels((key) => (DICT[lang] as Record<string, string>)[key]);
      for (const [name, value] of Object.entries(labels)) {
        assert.ok(typeof value === 'string' && value.trim().length > 0, `${lang}: ${name} is missing`);
      }
    }
    const differs = Object.values(RECEIPT_LABEL_KEYS).filter(
      (key) => (fr as Record<string, string>)[key] !== (en as Record<string, string>)[key],
    );
    assert.ok(differs.length >= 10, 'French must be a translation, not the English catalogue');
  });

  it('keeps identifiers, phone numbers and the invoice number left to right in Arabic', () => {
    const html = buildReceiptHtml(base({ customer: { name: 'أمينة', phone: '+22233445566' } }), ctx('ar'));
    const body = bodyOf(html);
    assert.match(body, new RegExp(`class="id">${IMEI}<`));
    assert.match(body, /class="muted ltr">\+22233445566</);
    assert.match(body, /class="no ltr">INV-2026-000123</);
    assert.match(body, new RegExp(`class="muted ltr">${dateTime(SOLD_AT)}<`));
    assert.match(html, /\.id \{[^}]*direction: ltr; unicode-bidi: isolate/);
    // Money too: "329 000 MRU" must not come out as "MRU 000 329".
    assert.match(html, /\.figure \{[^}]*direction: ltr; unicode-bidi: isolate/);
    assert.match(html, /td\.num \{ direction: ltr; unicode-bidi: isolate; \}/);
  });
});

describe('the page', () => {
  it('fills about 83% of A4 and Letter alike, with even margins and no gradient', () => {
    const html = buildReceiptHtml(base(), ctx());
    assert.match(html, /@page \{ margin: 16mm 18mm; \}/);
    assert.match(html, /body \{[^}]*width: 100%/);
    // The old thermal layout was an 80mm column; "180mm" in a comment is not it.
    assert.doesNotMatch(html, /(?<!\d)80mm|gradient|<img(?! class="logo")/);
  });

  it('shows a logo only when one is configured, and lays out the same without one', () => {
    assert.doesNotMatch(buildReceiptHtml(base(), ctx()), /<img/);
    const withLogo = buildReceiptHtml(base({ logoUri: 'data:image/png;base64,AAAA' }), ctx());
    assert.match(withLogo, /<img class="logo" src="data:image\/png;base64,AAAA" alt="" \/>/);
    assert.equal(rowsOf(withLogo), 1);
  });

  it('names the branch alone when the business name is unknown', () => {
    const html = buildReceiptHtml(base({ storeName: null }), ctx());
    assert.match(bodyOf(html), /<h1>Main Store<\/h1>/);
    assert.doesNotMatch(bodyOf(html), /Branch:/);
  });
});
