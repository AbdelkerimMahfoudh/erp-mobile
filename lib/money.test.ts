/**
 * The Money redesign and partial payments (0074) — the rules the phone decides,
 * and the shape of the screens that must never decide a figure.
 *
 *   node lib/money.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  collectionProblem,
  debtorFields,
  debtorProblem,
  methodForAccount,
  paidAtFrom,
  previewSalePayment,
  remainingAfter,
  saleDebtorFields,
} from './sale-payment-rules.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  try { fn(); passed++; } catch (e) { console.error(`✗ ${name}`); throw e; }
};
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const code = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ── status from money received ──────────────────────────────────────────────

it('the whole total received now is paid in full, nothing owed', () => {
  assert.deepEqual(previewSalePayment(25_000, 25_000), { remaining: 0, status: 'paid' });
});
it('15 000 of 25 000 is partially paid, 10 000 owed', () => {
  assert.deepEqual(previewSalePayment(25_000, 15_000), { remaining: 10_000, status: 'partial' });
});
it('nothing received is unpaid, the whole total owed', () => {
  assert.deepEqual(previewSalePayment(25_000, 0), { remaining: 25_000, status: 'credit' });
});

// ── who owes it ─────────────────────────────────────────────────────────────

it('a balance needs a debtor; a paid sale needs none', () => {
  assert.equal(debtorProblem(10_000, { kind: 'none' }), 'debtor_required');
  assert.equal(debtorProblem(0, { kind: 'none' }), null);
});
it('a typed customer needs a name, never a phone', () => {
  assert.equal(debtorProblem(10_000, { kind: 'customer_new', name: '  ', phone: '' }), 'customer_name_required');
  assert.equal(debtorProblem(10_000, { kind: 'customer_new', name: 'Mariam', phone: '' }), null);
  assert.deepEqual(debtorFields({ kind: 'customer_new', name: ' Mariam ', phone: '' }), { customer: { name: 'Mariam' } });
  assert.deepEqual(debtorFields({ kind: 'customer_new', name: 'Mariam', phone: '22 11' }), { customer: { name: 'Mariam', phone: '22 11' } });
});
it('a selected customer is sent by id, so no duplicate is created', () => {
  assert.deepEqual(debtorFields({ kind: 'customer_existing', customerId: 'c1', name: 'M' }), { customerId: 'c1' });
});
it('a partner store is sent as the counterparty, alone', () => {
  assert.deepEqual(debtorFields({ kind: 'store', counterpartyId: 's1', name: 'Atlas' }), { counterpartyId: 's1' });
});
it('a paid sale still keeps the customer the cashier attached', () => {
  assert.deepEqual(saleDebtorFields({ kind: 'none' }, 'c9'), { customerId: 'c9' });
  assert.deepEqual(saleDebtorFields({ kind: 'none' }, null), {});
  assert.deepEqual(saleDebtorFields({ kind: 'store', counterpartyId: 's1', name: 'A' }, 'c9'), { counterpartyId: 's1' }, 'a named debtor wins');
});

// ── recording a later payment ───────────────────────────────────────────────

it('a later payment must be positive, and no more than is owed', () => {
  const base = { remaining: 6_000, method: 'cash' as const, accountId: null, paidAt: null };
  assert.equal(collectionProblem({ ...base, amountText: '' }), 'amount_missing');
  assert.equal(collectionProblem({ ...base, amountText: '0' }), 'amount_not_positive');
  assert.equal(collectionProblem({ ...base, amountText: '-5' }), 'amount_not_positive');
  assert.equal(collectionProblem({ ...base, amountText: '6001' }), 'amount_over');
  assert.equal(collectionProblem({ ...base, amountText: '6000' }), null, 'exactly settling is allowed');
});
it('an account payment must name the account; cash names none', () => {
  assert.equal(collectionProblem({ amountText: '4000', remaining: 10_000, method: 'mobile', accountId: null, paidAt: null }), 'account_missing');
  assert.equal(collectionProblem({ amountText: '4000', remaining: 10_000, method: 'mobile', accountId: 'a', paidAt: null }), null);
});
it('a payment cannot be dated in the future', () => {
  const now = new Date('2026-09-19T10:00:00');
  const later = new Date('2026-09-19T12:00:00');
  assert.equal(collectionProblem({ amountText: '1', remaining: 5, method: 'cash', accountId: null, paidAt: later, now }), 'paid_at_future');
});
it('what is owed afterwards never goes below zero', () => {
  assert.equal(remainingAfter(10_000, '4000'), 6_000);
  assert.equal(remainingAfter(6_000, '6000'), 0);
  assert.equal(remainingAfter(6_000, 'abc'), 6_000);
});
it('a date and time become one instant, in the phone’s local time', () => {
  const at = paidAtFrom('2026-09-19', '15:10')!;
  assert.equal(at.getFullYear(), 2026);
  assert.equal(at.getHours(), 15);
  assert.equal(at.getMinutes(), 10);
  assert.equal(paidAtFrom(null, null), null, 'nothing chosen means now');
});
it('an account implies its method: a bank is a transfer, a wallet is mobile', () => {
  assert.equal(methodForAccount('bim_bank'), 'bank');
  assert.equal(methodForAccount('bankily'), 'mobile');
  assert.equal(methodForAccount('sedad'), 'mobile');
});

// ── the Money overview never decides a figure ───────────────────────────────

const overview = code(read('../app/(tabs)/money-hub.tsx'));

it('the overview reads the server overview, and adds nothing up itself', () => {
  assert.match(overview, /useMoneyOverview\(range\.from, range\.to/);
  assert.ok(!/\.reduce\(/.test(overview), 'no figure is summed on the phone');
  // "Items sold" is every item, less cancelled ones (docs/53 R6) — it used to show phones only.
  for (const f of ['data.cashNow', 'data.period.salesValue', 'data.period.collected', 'data.period.outstanding', 'data.period.unitsSold']) {
    assert.ok(overview.includes(f), `${f} comes from the server`);
  }
});
it('Sales value, Collected, Still owed and Cash are four different labels', () => {
  for (const k of ['moneyOverview.salesValue', 'moneyOverview.collected', 'moneyOverview.outstanding', 'moneyOverview.cashNow']) {
    assert.match(overview, new RegExp(`t\\('${k.replace('.', '\\.')}'\\)`));
  }
});
it('the overview previews a few sales and links to all of them', () => {
  assert.match(overview, /SALES_PREVIEW = 3/);
  assert.match(overview, /\.slice\(0, SALES_PREVIEW\)/);
  assert.match(overview, /t\('moneyOverview\.viewAllSales'\)/);
});
it('accounts are recorded movement, never called a balance', () => {
  assert.match(overview, /t\('moneyOverview\.accounts\.hint'\)/);
  assert.match(overview, /t\('moneyTab\.recorded'\)/);
});
it('Outstanding payments and the other actions come from the registry', () => {
  assert.match(overview, /visibleChildren\(hub, granted\)/);
  assert.ok(!/'\/outstanding'|'\/expenses'|'\/closing'|'\/loans'/.test(overview), 'no route is written into the tab');
});

// ── recording a later payment: one key, reviewed first ──────────────────────

const pay = code(read('../app/sales/pay/[id].tsx'));
const hooks = code(read('./money-overview.ts'));

it('one key covers the whole attempt and is renewed only after success', () => {
  assert.match(hooks, /const key = useRef\(uuidv4\(\)\)/);
  assert.match(hooks, /clientUuid: key\.current/);
  const success = hooks.slice(hooks.indexOf('onSuccess'));
  assert.match(success, /key\.current = uuidv4\(\)/, 'a fresh key only once the payment is recorded');
});
it('the payment is reviewed before it is saved, and says what will be left', () => {
  const confirmAt = pay.indexOf('dialog.confirm');
  const mutateAt = pay.indexOf('record.mutate(');
  assert.ok(confirmAt > 0 && mutateAt > confirmAt, 'confirm comes first');
  assert.match(pay, /recordPayment\.review\.body/);
  assert.match(pay, /recordPayment\.review\.settles/);
});
it('the screen shows the debtor, the sale, before and after', () => {
  for (const k of ['recordPayment.before', 'recordPayment.after', 'recordPayment.this', 'recordPayment.onlyReceived']) {
    assert.match(pay, new RegExp(k.replace('.', '\\.')));
  }
  assert.match(pay, /sale\.debtor\?\.name/);
});
it('a collection refreshes cash, the account, the overview and the sale', () => {
  assert.match(hooks, /invalidateMoney\(qc\)/);
  assert.match(hooks, /qk\.sale\(saleId\)/);
  const prefixes = read('./money-invalidation.ts');
  for (const k of ['money-overview', 'outstanding', 'sales-by-day']) assert.ok(prefixes.includes(`'${k}'`), k);
});

// ── selling with a balance ──────────────────────────────────────────────────

const sheet = code(read('../components/sell/PaymentSheet.tsx'));

it('the sheet may take less than the total, and never more', () => {
  assert.match(sheet, /disabled=\{overpaid \|\| owedBy !== null/);
  assert.match(sheet, /previewSalePayment\(total, paid\)/);
});
it('nothing received now sends no payment at all', () => {
  assert.match(sheet, /paid > 0\s*\?\s*\[/);
  assert.match(sheet, /:\s*\[\],\s*debtorToSend/);
});
it('the debtor is asked for only when something is left owing', () => {
  assert.match(sheet, /remaining > 0\.005 \? \(/);
  assert.match(sheet, /<DebtorPicker/);
});
it('both sale screens carry the debtor through every retry', () => {
  for (const f of ['../app/(tabs)/sell.tsx', '../app/quick-sell.tsx']) {
    const src = code(read(f));
    assert.match(src, /heldDebtor = useRef<DebtorDraft>/);
    assert.match(src, /saleDebtorFields\(heldDebtor\.current/);
  }
});

// ── sale detail ─────────────────────────────────────────────────────────────

const detail = code(read('../app/sales/[id].tsx'));

it('every payment shows amount, time, account as it was, reference and who recorded it', () => {
  const line = detail.slice(detail.indexOf('function PaymentLine'));
  for (const f of ['p.amount', 'p.paidAt', 'p.accountLabel', 'p.reference', 'p.recordedBy']) assert.ok(line.includes(f), f);
});
it('Record payment appears only while something is owed, for whoever may sell', () => {
  assert.match(detail, /usePermission\('sale\.create'\) && sale\.balanceDue > 0 && !sale\.isReversed/);
});
it('status is shown in words and colour for every state, Paid in full included', () => {
  assert.match(detail, /<StatusChip domain="sale" value=\{sale\.payStatus\} \/>/);
});

// ── presentation rules ──────────────────────────────────────────────────────

const NEW_SCREENS = [
  '../app/(tabs)/money-hub.tsx',
  '../app/sales/period.tsx',
  '../app/sales/pay/[id].tsx',
  '../app/outstanding.tsx',
  '../components/money/SaleRow.tsx',
  '../components/sell/DebtorPicker.tsx',
];

it('no raw colours in the new screens', () => {
  for (const f of NEW_SCREENS) assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(code(read(f))), `${f} uses a raw colour`);
});
it('no hardcoded copy between tags in the new screens', () => {
  for (const f of NEW_SCREENS) {
    const src = code(read(f));
    // A tag's closing '>', never the '>' of an arrow function's '=>'.
    const literal = src.match(/(?<![=])>\s*[A-Za-z؀-ۿ][^<{}]*</);
    assert.equal(literal, null, `${f} has literal text: ${literal?.[0]}`);
  }
});
it('the sale row chevron turns in Arabic', () => {
  assert.match(code(read('../components/money/SaleRow.tsx')), /isRTL\(\) \? styles\.flip/);
});
it('a week or month is read a day at a time, never as one long list', () => {
  const period = code(read('../app/sales/period.tsx'));
  assert.match(period, /useSalesByDay\(range\.from, range\.to/);
  assert.match(period, /\{open \? <DaySales day=\{day\.day\} \/> : null\}/, 'a day’s sales mount only when opened');
});
it('every new key exists in English, French and Arabic', () => {
  const keys = new Set<string>();
  for (const f of NEW_SCREENS.concat(['../components/sell/PaymentSheet.tsx', '../app/sales/[id].tsx', '../app/expenses/new.tsx'])) {
    for (const m of read(f).matchAll(/t\('((?:moneyOverview|saleRow|saleDetail|recordPayment|outstanding|salesPeriod|sellDebt|expenses)\.[A-Za-z0-9.]+)'/g)) keys.add(m[1]);
  }
  assert.ok(keys.size > 50, `expected the redesign's keys, found ${keys.size}`);
  for (const locale of ['en', 'fr', 'ar']) {
    const cat = read(`./i18n/${locale}.ts`);
    for (const k of keys) assert.ok(cat.includes(`'${k}':`), `${locale} is missing ${k}`);
  }
});
it('the expense form asks for a description, amount, source, date and an optional photo — no chips', () => {
  const form = code(read('../app/expenses/new.tsx'));
  assert.match(form, /t\('expenses\.category'\)/);
  assert.match(form, /t\('expenses\.date'\)/);
  assert.match(form, /t\('expenses\.receipt\.add'\)/);
  assert.ok(!/FilterChip/.test(form), 'no suggestion chips under the description');
  assert.match(read('./i18n/en.ts'), /'expenses\.category': "Description"/);
});
it('one payment-status vocabulary: Paid in full, Partially paid, Unpaid', () => {
  const en = read('./i18n/en.ts');
  assert.match(en, /'status\.sale\.paid': 'Paid in full'/);
  assert.match(en, /'status\.sale\.partial': 'Partially paid'/);
  assert.match(en, /'status\.sale\.credit': 'Unpaid'/);
});

console.log(`money: ${passed} passed`);
