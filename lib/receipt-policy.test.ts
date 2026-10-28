/**
 * The customer and the return policy on the receipt (D223 device QA, 2026-10-28) — proved without a screen.
 *
 *   node lib/receipt-policy.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildReceiptHtml, receiptLabels, type ReceiptContext, type ReceiptData } from './receipt-html.ts';
import { receiptPolicyText, type ReturnPolicySnapshot } from './return-policy.ts';
import { accessNotice, businessAccess } from './access.ts';
import { en } from './i18n/en.ts';
import { ar } from './i18n/ar.ts';
import { formatMoney } from './money-format.ts';

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

const ctx = (lang: 'en' | 'ar', policy: ReturnPolicySnapshot): ReceiptContext => {
  const dict = (lang === 'ar' ? ar : en) as Record<string, string>;
  return {
    labels: receiptLabels((key) => dict[key]),
    lang,
    rtl: lang === 'ar',
    formatMoney,
    formatDateTime: (d: Date) => d.toISOString().slice(0, 16),
    policyLine: policy.windowHours > 0 ? 'Returnable within 3 days' : 'This sale is final — no returns.',
    policyConditions: receiptPolicyText(policy, lang),
  };
};

const POLICY: ReturnPolicySnapshot = {
  windowHours: 72,
  deadlineAt: '2026-10-31T15:25:00.000Z',
  texts: {
    en: 'Manufacturing defects only.\nUndamaged, with every original accessory.',
    fr: null,
    ar: 'عيوب التصنيع فقط.\nدون ضرر، ومع كل الملحقات الأصلية.',
  },
  textLanguage: 'en',
  policyVersion: 2,
};

const sale = (over: Partial<ReceiptData> = {}): ReceiptData => ({
  invoiceNo: '00002',
  soldAt: new Date('2026-10-28T15:25:00.000Z'),
  branchName: 'Main counter',
  cashierName: 'QA Owner 1',
  customer: { name: 'Mariem Fictive', phone: '+222 00 00 00 00' },
  lines: [{ label: 'HMD HMD 105', identifier: '001010021000144', quantity: 1, unitPrice: 1400 }],
  subtotal: 1400,
  discount: 0,
  total: 1400,
  payments: [{ method: 'Cash', amount: 1400 }],
  returnPolicy: POLICY,
  ...over,
});

const body = (html: string) => html.slice(html.indexOf('<body>'));

it('the name entered at the sale is printed — never "Cash customer" when one was given', () => {
  const html = body(buildReceiptHtml(sale(), ctx('en', POLICY)));
  assert.match(html, /Mariem Fictive/);
  assert.doesNotMatch(html, new RegExp(en['receipt.cashCustomer']));
});

it('no name: the generic cash-customer wording, as before', () => {
  const html = body(buildReceiptHtml(sale({ customer: null }), ctx('en', POLICY)));
  assert.match(html, new RegExp(en['receipt.cashCustomer']));
});

it('a customer name is escaped like every other value', () => {
  const html = body(buildReceiptHtml(sale({ customer: { name: '<b>Ali</b> & co' } }), ctx('en', POLICY)));
  assert.match(html, /&lt;b&gt;Ali&lt;\/b&gt; &amp; co/);
  assert.doesNotMatch(html, /<b>Ali<\/b>/);
});

it('prints the window and the written conditions of THIS sale, line breaks kept', () => {
  const html = body(buildReceiptHtml(sale(), ctx('en', POLICY)));
  assert.match(html, /Returnable within 3 days/);
  assert.match(html, /<div class="conditions">Manufacturing defects only\.\nUndamaged, with every original accessory\.<\/div>/);
  assert.match(buildReceiptHtml(sale(), ctx('en', POLICY)), /\.conditions \{ white-space: pre-line; overflow-wrap: anywhere;/);
});

it('Arabic: the Arabic conditions, right to left', () => {
  const html = buildReceiptHtml(sale(), ctx('ar', POLICY));
  assert.match(html, /dir="rtl"/);
  assert.match(body(html), /عيوب التصنيع فقط\./);
  assert.doesNotMatch(body(html), /Manufacturing defects/);
});

it('a language with no text falls back to the default language, then to the neutral sentence alone — never a translation', () => {
  assert.equal(receiptPolicyText(POLICY, 'fr'), POLICY.texts!.en);
  assert.equal(receiptPolicyText({ ...POLICY, textLanguage: 'ar' }, 'fr'), POLICY.texts!.ar);
  const legacy: ReturnPolicySnapshot = { windowHours: 0, deadlineAt: null };
  assert.equal(receiptPolicyText(legacy, 'en'), null);
  const html = body(buildReceiptHtml(sale({ returnPolicy: legacy }), ctx('en', legacy)));
  assert.match(html, /This sale is final — no returns\./);
  assert.doesNotMatch(html, /class="conditions"/);
});

it('a no-return sale prints its own written explanation when it has one', () => {
  const none: ReturnPolicySnapshot = { windowHours: 0, deadlineAt: null, texts: { en: 'All sales final: tested in front of you.', fr: null, ar: null }, textLanguage: 'en' };
  const html = body(buildReceiptHtml(sale({ returnPolicy: none }), ctx('en', none)));
  assert.match(html, /This sale is final — no returns\./);
  assert.match(html, /All sales final: tested in front of you\./);
});

it('the written conditions are escaped: markup is printed as text, never run', () => {
  const evil: ReturnPolicySnapshot = { ...POLICY, texts: { en: '<img src=x onerror=alert(1)>', fr: null, ar: null } };
  const html = body(buildReceiptHtml(sale({ returnPolicy: evil }), ctx('en', evil)));
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img/);
});

it('carries no cost, no margin and no internal id', () => {
  const html = body(buildReceiptHtml(sale(), ctx('en', POLICY)));
  assert.doesNotMatch(html, /cost|margin|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
});

/* ── every path prints the server's snapshot, never the current settings ── */

it('the receipt, its share and the browser copy take the conditions from the sale snapshot', () => {
  assert.match(withoutComments(source('lib/receipt.ts')), /policyConditions: receiptPolicyText\(data\.returnPolicy, lang\)/);
  for (const file of ['lib/receipt.ts', 'lib/receipt-html.ts', 'app/sales/[id].tsx']) {
    assert.doesNotMatch(source(file), /api\.(get|put)[^\n]*['`]\/return-policy/, `${file} must never read the current policy`);
  }
});

it('the checkout and a reprint name the customer from the server snapshot', () => {
  for (const file of ['app/quick-sell.tsx', 'app/(tabs)/sell.tsx']) {
    assert.match(withoutComments(source(file)), /customer: sale\.customer \?\? null,/, file);
  }
  const reprint = withoutComments(source('app/sales/[id].tsx'));
  assert.match(reprint, /sale\.receiptCustomer !== undefined\s*\?\s*sale\.receiptCustomer/);
  assert.match(reprint, /texts: sale\.returnPolicy\.texts \?\? null/);
});

/* ── the Sale screen no longer decides the policy ────────────────────────── */

it('no screen chooses a return policy for a sale, or sends one', () => {
  for (const file of ['app/quick-sell.tsx', 'app/(tabs)/sell.tsx']) {
    assert.doesNotMatch(source(file), /ReturnPolicyCard|returnWindowHours|return\.policy\.override/, file);
  }
});

/* ── the scanner's purpose ───────────────────────────────────────────────── */

it('Sale scans for selling, Receive for receiving', () => {
  assert.match(source('app/quick-sell.tsx'), /purpose="sell"/);
  assert.match(source('app/(tabs)/sell.tsx'), /purpose="sell"\s*inSale=\{inCart\}/);
  assert.match(source('app/quick-receive.tsx'), /purpose="receive"/);
  assert.match(source('app/receive.tsx'), /purpose="receive"/);
  const sheet = withoutComments(source('components/scanner/ScannerSheet.tsx'));
  // Selling looks the unit up as a sale; only receiving runs the duplicate lookup.
  assert.match(sheet, /if \(purpose === 'sell'\) \{[\s\S]*?lookupSelection\(primary\)[\s\S]*?return;\s*\}\s*void scanQuietly\(primary\);/);
  for (const gate of ["purpose !== 'sell' && alreadyHeld", "purpose !== 'sell' && primary && !result.problem", "purpose !== 'sell' && primary && !secondary && !result.problem"]) {
    assert.ok(sheet.includes(gate), gate);
  }
});

/* ── the staff allowance is no tab banner ────────────────────────────────── */

it('the Business access staff warning is absent from every tab; Team still explains a refusal', () => {
  const over = businessAccess({ state: 'active', canWrite: true, overLimit: true, seatsUsed: 9 } as never);
  assert.equal(accessNotice(over), 'none');
  assert.doesNotMatch(source('components/access/AccessNotice.tsx'), /access\.staff\.over/);
  assert.match(source('app/team.tsx'), /SEAT_LIMIT_REACHED/);
});

console.log(`receipt and policy: ${passed} passed`);
