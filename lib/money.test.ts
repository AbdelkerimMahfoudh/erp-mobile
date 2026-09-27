/**
 * The Money redesign and partial payments (0074) — the rules the phone decides,
 * and the shape of the screens that must never decide a figure.
 *
 *   node lib/money.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatMoney } from './money-format.ts';
import {
  amountProblem,
  collectionProblem,
  debtorFields,
  debtorProblem,
  MAX_PAYMENT_METHODS,
  methodForAccount,
  nextFreeSource,
  paidAtFrom,
  previewSalePayment,
  remainingAfter,
  saleDebtorFields,
  splitProblem,
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
  for (const f of ['cardData.moneyToday.total.net', 'cardData.moneyToday.channels', 'data.period.salesValue', 'data.period.collected', 'data.period.outstanding', 'data.period.unitsSold']) {
    assert.ok(overview.includes(f), `${f} comes from the server`);
  }
  // A drawer estimate is never added to account movement: the card shows one basis, the server's total of its rows.
  assert.ok(!/[dD]ata\.cashNow/.test(overview), 'the drawer estimate is not on the card');
  // The card is always today's, on its own query: another period never blanks it, and Today shares its cache.
  assert.match(overview, /const todayRange = usePeriodRange\('today'\);\s*const card = useMoneyOverview\(todayRange\.from, todayRange\.to, \{ enabled: canViewFigures \}\);/);
});
it('Sales value, Collected, Still owed and Money recorded today are four different labels', () => {
  for (const k of ['moneyOverview.salesValue', 'moneyOverview.collected', 'moneyOverview.outstanding', 'moneyTab.today.title']) {
    assert.match(overview, new RegExp(`t\\('${k.replace(/\./g, '\\.')}'\\)`));
  }
});
it('the overview previews a few sales and links to all of them', () => {
  assert.match(overview, /SALES_PREVIEW = 3/);
  assert.match(overview, /\.slice\(0, SALES_PREVIEW\)/);
  assert.match(overview, /t\('moneyOverview\.viewAllSales'\)/);
});
it('each method is recorded movement, never called a balance — and the card says which day (docs/55 D42, 2026-09-27)', () => {
  assert.match(overview, /t\('moneyTab\.today\.hint', \{ date: formatDate\(cardData\.today\) \}\)/);
  assert.match(overview, /t\('moneyOverview\.dailyExpenses\.hint', \{ date: formatDate\(data\.today\) \}\)/);
  const en = read('./i18n/en.ts');
  assert.match(en, /'moneyTab\.today\.hint': 'Money in less money out, recorded in this app today \(\{date\}\) for each method\. Not a drawer count, not an account balance\.'/);
});
it('the top card is the money held as the server tracks it: its total, or no figure at all while a method is unknown (2026-09-27)', () => {
  const heldAt = overview.indexOf("t('moneyTab.held.title')");
  const todayAt = overview.indexOf("t('moneyTab.today.title')");
  assert.ok(heldAt > 0 && todayAt > heldAt, 'Money held comes first, Money recorded today after it');
  const held = overview.slice(heldAt, todayAt);
  assert.match(overview, /const held = cardData\?\.trackedMoney;/);
  // The figure is the server's total, never a sum made here; without one the line names the unknown methods instead.
  assert.match(held, /\) : held\.total !== null \? \(\s*<MoneyValue value=\{held\.total\} size="display" signed=\{held\.total < 0\} decimals=\{heldDecimals\} \/>\s*\) : \(\s*<Text variant="bodyStrong">\s*\{t\('moneyTab\.held\.incomplete', \{/);
  assert.match(held, /names: held\.methods\s*\.filter\(\(m\) => !m\.known\)\s*\.map\(\(m\) => \(m\.channel === 'cash' \? t\('moneyTab\.cash'\) : m\.label\)\)/);
  assert.equal(held.match(/<MoneyValue/g)?.length, 1, 'the total is the card’s only figure outside the method rows');
  assert.ok(!/\.reduce\(|position \+|\+ m\.position/.test(overview), 'no position is added up on the phone');
  assert.match(held, /t\('moneyTab\.held\.hint'\)/);
  assert.match(held, /held\.methods\.map\(\(m\) => \(\s*<HeldLine\s+key=\{m\.key\}\s+method=\{m\}\s+branchCount=\{held\.branchCount\}\s+decimals=\{heldDecimals\}/);
  // Cents on any figure, the starting amounts included, put every figure of the card at two decimals.
  assert.match(overview, /const heldDecimals = held && \[held\.total, \.\.\.held\.methods\.flatMap\(\(m\) => \[m\.position, m\.anchor\?\.amount \?\? null\]\)\]\.some\(/);
});
it('money held for someone other than the Owner: the drawer, a line saying the accounts are the Owner’s, and no total (TM-3)', () => {
  const heldAt = overview.indexOf("t('moneyTab.held.title')");
  const held = overview.slice(heldAt, overview.indexOf("t('moneyTab.today.title')"));
  // Asked first, so no figure is ever shown for the drawer alone, and the unknown-methods line never stands in for it.
  assert.match(held, /<View style=\{styles\.total\}>\s*\{!held\.accountsVisible \? \(\s*<Text variant="bodyStrong">\{t\('moneyTab\.held\.ownerOnly'\)\}<\/Text>\s*\) : held\.total !== null \? \(/);
  // The rows are the server's list: the drawer alone when the accounts are not shown.
  assert.match(held, /held\.methods\.map\(\(m\) => \(/);
  const lib = code(read('./money-overview.ts'));
  assert.match(lib, /branchCount: number;\s*accountsVisible: boolean;/);
  assert.match(code(read('./contract.ts')), /typeof r\?\.trackedMoney\?\.accountsVisible === 'boolean' \? \[\] : \['trackedMoney\.accountsVisible'\]/);
  const words = { en: 'Account amounts are shown to the Owner.', fr: 'Les montants des comptes sont visibles par le propriétaire.', ar: 'مبالغ الحسابات يراها المالك.' };
  for (const [locale, line] of Object.entries(words)) assert.ok(read(`./i18n/${locale}.ts`).includes(`'moneyTab.held.ownerOnly': '${line}',`), locale);
});
it('each held method: a position or the word Unknown — never a 0 — and where it starts from, or which start is missing', () => {
  const line = overview.slice(overview.indexOf('function HeldLine'), overview.indexOf('function MethodLine'));
  assert.match(line, /const position = m\.known \? m\.position : null;/);
  assert.match(line, /\{position !== null \? \(\s*<MoneyValue value=\{position\} size="small" signed=\{position < 0\} decimals=\{decimals\} \/>\s*\) : \(\s*<Text variant="bodyStrong" tone="secondary">\s*\{t\('moneyTab\.held\.unknown'\)\}/);
  assert.match(line, /const name = cash \? t\('moneyTab\.cash'\) : m\.scope === 'company' && branchCount > 1 \? `\$\{m\.label\} \$\{t\('moneyTab\.held\.wholeBusiness'\)\}` : m\.label;/);
  assert.match(line, /!anchor\s*\?\s*t\(cash \? 'moneyTab\.held\.cash\.unknown' : 'moneyTab\.held\.account\.unknown'\)/);
  assert.match(line, /cash\s*\?\s*t\('moneyTab\.held\.cash\.known', \{ date \}\)/);
  assert.match(line, /const amount = anchor \? isolateLtr\(formatMoney\(anchor\.amount, \{ decimals \}\)\) : '';/);
  assert.match(line, /anchor\.byName\s*\?\s*t\('moneyTab\.held\.account\.knownBy', \{ amount, date, name: anchor\.byName \}\)\s*:\s*t\('moneyTab\.held\.account\.known', \{ amount, date \}\)/);
});
it('Set amount is offered on each account row to whoever holds money.anchor.record, and to nobody else', () => {
  assert.match(overview, /const canAnchor = usePermission\('money\.anchor\.record'\);/);
  assert.match(overview, /onSetAmount=\{\s*canAnchor && m\.channel === 'account'\s*\?\s*\(\) => \{\s*setAnchorFor\(m\);\s*setAnchorOpen\(true\);\s*\}\s*:\s*undefined\s*\}/);
  const line = overview.slice(overview.indexOf('function HeldLine'), overview.indexOf('function MethodLine'));
  assert.match(line, /\{onSetAmount \? \(\s*<View style=\{styles\.action\}>\s*<Button\s+title=\{t\('moneyTab\.held\.setAmount'\)\}[\s\S]*?variant="tertiary"\s+size="sm"\s+onPress=\{onSetAmount\}/);
  assert.match(overview, /\{canAnchor \? <SetStartingAmountSheet open=\{anchorOpen\} account=\{anchorFor\} onClose=\{\(\) => setAnchorOpen\(false\)\} \/> : null\}/);
  assert.match(read('./permissions.ts'), /'money\.anchor\.record',/);
});
it('Money recorded today stays a card of its own, right below, with its rows and nothing held in it', () => {
  const todayAt = overview.indexOf("t('moneyTab.today.title')");
  const today = overview.slice(todayAt, overview.indexOf('</Card>', todayAt));
  const between = overview.slice(overview.indexOf("t('moneyTab.held.title')"), todayAt);
  assert.equal(between.match(/<\/Card>/g)?.length, 1, 'the held card closes before today’s opens');
  assert.match(between, /<\/Card>\s*<Card style=\{styles\.cash\}>/);
  assert.match(today, /cardData\.moneyToday\.total\.net/);
  assert.match(today, /t\('moneyTab\.today\.hint', \{ date: formatDate\(cardData\.today\) \}\)/);
  assert.match(today, /cardData\.moneyToday\.channels\.map\(\(m\) => \(\s*<MethodLine/);
  assert.ok(!/held|trackedMoney/.test(today), 'no position among today’s movement');
  assert.ok(!/moneyToday/.test(between), 'no movement among the positions');
});
it('the starting-amount sheet posts the account, the amount and a key bound to them, then says so and refreshes Money', () => {
  const lib = code(read('./money-overview.ts'));
  const anchorHook = lib.slice(lib.indexOf('export function useRecordMoneyAnchor'));
  assert.match(anchorHook, /const payload = \{ accountId, amount, \.\.\.\(note\.trim\(\) \? \{ note: note\.trim\(\) \} : \{\}\) \};/);
  assert.match(anchorHook, /if \(attempt\.current\?\.payload !== sent\) attempt\.current = \{ clientUuid: uuidv4\(\), payload: sent \};/);
  assert.match(anchorHook, /api\.post<RecordedAnchor>\('\/money\/anchors', \{ clientUuid: attempt\.current\.clientUuid, \.\.\.payload \}\)/);
  assert.match(anchorHook, /onSuccess: \(\) => \{\s*attempt\.current = null;\s*\},/);
  // Money is read again however the request ended: a lost answer may still have saved the amount.
  assert.match(anchorHook, /onSettled: \(\) => invalidateMoney\(qc\),/);
  // The key lives for one opening of the sheet: reset forgets it, with whatever the last attempt left showing.
  assert.match(anchorHook, /const reset = useCallback\(\(\) => \{\s*attempt\.current = null;\s*resetMutation\(\);\s*\}, \[resetMutation\]\);\s*return \{ \.\.\.mutation, reset \};/);
  const anchorSheet = code(read('../components/money/SetStartingAmountSheet.tsx'));
  assert.match(anchorSheet, /const record = useRecordMoneyAnchor\(\);\s*const \{ reset: newAttempt \} = record;/);
  assert.match(anchorSheet, /useEffect\(\(\) => \{\s*if \(open\) newAttempt\(\);\s*\}, \[open, newAttempt\]\);/);
  assert.match(anchorSheet, /<BottomSheet\s+open=\{open\}\s+onClose=\{close\}\s+title=\{t\('moneyTab\.anchor\.title', \{ account: name \}\)\}/);
  // Whatever closed it, the next opening starts empty, with a new key: a figure typed for one account is never saved for another.
  assert.match(anchorSheet, /const close = \(\) => \{\s*setAmount\(''\);\s*setNote\(''\);\s*newAttempt\(\);\s*onClose\(\);/);
  // Save is pinned above the keyboard, and the fields scroll beneath it.
  assert.match(anchorSheet, /footer=\{\s*<Button\s+title=\{t\('moneyTab\.anchor\.save'\)\}/);
  assert.match(anchorSheet, /<ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle=\{styles\.body\}>/);
  assert.match(anchorSheet, /t\('moneyTab\.anchor\.body', \{ account: name \}\)/);
  // Zero or more: the field offers no minus and the amount is read as non-negative, two decimals at most.
  assert.match(anchorSheet, /const parsed = parseAmount\(amount\);/);
  assert.ok(!/allowNegative/.test(anchorSheet), 'what an account holds is never below zero');
  assert.match(anchorSheet, /record\.mutate\(\s*\{ accountId: account\.accountId, amount: parsed\.value, note \},/);
  assert.match(anchorSheet, /onSuccess: \(\) => \{\s*toast\.success\(t\('moneyTab\.anchor\.saved'\)\);\s*onClose\(\);/);
  // No answer is not a refusal: a timeout says the amount may be saved, and to look before trying again.
  assert.match(
    anchorSheet,
    /toast\.error\(\s*t\(e instanceof RequestTimeout \? 'moneyTab\.anchor\.maybeSaved' : e instanceof ApiError && e\.status === 403 \? 'moneyTab\.anchor\.forbidden' : 'moneyTab\.anchor\.failed'\),\s*\)/,
  );
  assert.match(anchorSheet, /import \{ RequestTimeout \} from '\.\.\/\.\.\/lib\/offline\/classify';/);
  assert.match(anchorSheet, /title=\{t\('moneyTab\.anchor\.save'\)\}[\s\S]*?disabled=\{record\.isPending \|\| !online \|\| !parsed\.ok\}/);
  assert.match(anchorSheet, /label=\{t\('moneyTab\.anchor\.note'\)\} value=\{note\} onChangeText=\{setNote\} maxLength=\{255\}/);
});
it('the money-held words are in all three languages', () => {
  const keys = [
    'title', 'hint', 'incomplete', 'ownerOnly', 'unknown', 'wholeBusiness', 'cash.known', 'cash.unknown', 'account.known', 'account.knownBy', 'account.unknown', 'setAmount',
  ].map((k) => `moneyTab.held.${k}`).concat(['title', 'body', 'amount', 'note', 'save', 'saved', 'failed', 'maybeSaved', 'forbidden'].map((k) => `moneyTab.anchor.${k}`));
  for (const locale of ['en', 'fr', 'ar']) {
    const cat = read(`./i18n/${locale}.ts`);
    for (const k of keys) assert.ok(cat.includes(`'${k}':`), `${locale} is missing ${k}`);
  }
  const en = read('./i18n/en.ts');
  assert.match(en, /'moneyTab\.held\.title': 'Money held'/);
  assert.match(en, /'moneyTab\.held\.hint': 'Starting amounts plus everything recorded in this app since\. Not a bank or wallet balance\.'/);
  assert.match(en, /'moneyTab\.held\.incomplete': 'Not every method is tracked yet: \{names\}\.'/);
  assert.match(en, /'moneyTab\.held\.unknown': 'Unknown'/);
  assert.match(en, /'moneyTab\.held\.account\.knownBy': 'From \{amount\} on \{date\} by \{name\}, plus what was recorded since\.'/);
  assert.match(en, /'moneyTab\.anchor\.body': 'Open the \{account\} app and enter the amount it shows now\. From now on, this app adds what is recorded here\.'/);
  assert.match(en, /'moneyTab\.anchor\.maybeSaved': 'The answer did not arrive\. The amount may have been saved — check Money held before trying again\.'/);
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
  assert.match(sheet, /disabled=\{amountBad \|\| overpaid \|\| owedBy !== null/);
  assert.match(sheet, /previewSalePayment\(total, paid\)/);
});
it('nothing received now sends no payment at all', () => {
  assert.match(sheet, /paid > 0\s*\?\s*\[/);
  assert.match(sheet, /:\s*\[\],\s*debtorToSend/);
});
it('whatever the money taken now leaves — one method or a split — is owed by a named debtor (2026-09-27)', () => {
  assert.ok(!/multiSplit/.test(sheet), 'a split is not judged apart from one method');
  assert.match(sheet, /const owing = remaining > 0\.005;/);
  assert.match(sheet, /const overpaid = remaining < -0\.005;/);
  assert.match(sheet, /const debtorBlock = owing \? \(\s*<>\s*<Card variant="warning"/);
  assert.match(sheet, /<DebtorPicker/);
  assert.match(sheet, /title=\{owing \? t\('sell\.payment\.review'\) : t\('sell\.payment\.complete'\)\}/);
});
it('what is owed sits under the one-method field, and after the parts while splitting, so nothing jumps above the amount being typed', () => {
  const field = sheet.indexOf("t('sell.payment.receivedNow')");
  const single = sheet.indexOf('{isSplitting ? null : debtorBlock}');
  const disclosure = sheet.indexOf('<Disclosure');
  const parts = sheet.indexOf('parts.map((entry) =>');
  const disclosureEnd = sheet.indexOf('</Disclosure>');
  const split = sheet.indexOf('{isSplitting ? debtorBlock : null}');
  assert.ok(field > 0 && single > field && single < disclosure, 'one method: under the received field');
  assert.ok(parts > disclosure && disclosureEnd > parts && split > disclosureEnd, 'splitting: after the parts and the More options content');
  assert.equal(sheet.match(/debtorBlock/g)?.length, 3, 'defined once, rendered in exactly these two places');
});
it('a split: at most four places, each once, each with an amount — refused with the reason on screen', () => {
  assert.match(sheet, /const splitIssue = isSplitting \? splitProblem\(parts\) : null;/);
  assert.match(sheet, /disabled=\{amountBad \|\| overpaid \|\| owedBy !== null \|\| !accountsSettled \|\| splitIssue !== null\}/);
  assert.match(sheet, /if \(split\.length >= MAX_PAYMENT_METHODS\) \{\s*setLimitHit\('max'\);\s*return;/);
  assert.match(sheet, /nextFreeSource\(split, accounts\.map\(\(a\) => a\.id\)\) === null\) \{\s*setLimitHit\('noPlace'\);/);
  assert.match(sheet, /\{t\(limitHit === 'max' \? 'sell\.payment\.split\.max' : 'sell\.payment\.split\.noPlace'\)\}/);
  assert.match(sheet, /accounts=\{accountsFor\(entry\)\}/);
  assert.match(sheet, /splitIssue === 'too_many'\s*\?\s*'sell\.payment\.split\.max'\s*:\s*splitIssue === 'duplicate'\s*\?\s*'sell\.payment\.split\.duplicate'\s*:\s*'sell\.payment\.split\.empty'/);
  assert.match(sheet, /\) : overpaid \? \(\s*<Text[^>]*>\s*\{isSplitting\s*\?\s*t\('sell\.payment\.split\.over', \{ sum: formatMoney\(splitSum, \{ decimals \}\), total: formatMoney\(total, \{ decimals \}\) \}\)\s*:\s*t\('sell\.payment\.exactOnly'\)\}/);
  assert.ok(!/sell\.payment\.split\.sum|sum_mismatch/.test(sheet), 'a split no longer has to pay the whole amount');
  assert.ok(!/\.filter\(\(entry\) => entry\.amount > 0\)/.test(sheet), 'an empty part is refused on screen, never dropped on the way out');
  assert.ok(!/returns\.policy\.reason|policyNeedsReason/.test(sheet), 'no "Why is this sale different?" and no blocker for it');
  for (const locale of ['en', 'fr', 'ar']) {
    const cat = read(`./i18n/${locale}.ts`);
    assert.ok(!cat.includes("'sell.payment.split.sum':"), `${locale} still says a split pays the whole amount`);
    for (const k of ['sell.payment.split.over', 'sell.payment.split.empty', 'sellDebt.review.bodySplit']) assert.ok(cat.includes(`'${k}':`), `${locale} is missing ${k}`);
  }
  assert.match(read('./i18n/en.ts'), /'sell\.payment\.split\.over': 'The parts add up to \{sum\}, more than the \{total\} due\. Lower a part\.'/);
  // The rule itself.
  assert.equal(MAX_PAYMENT_METHODS, 4);
  // A part as typed: its amount is the field's text.
  const part = (method: string, amount: number | string, receivingAccountId?: string) => ({ method, amountText: String(amount), receivingAccountId });
  assert.equal(splitProblem([part('cash', 3000), part('mobile', 2000, 'b')]), null, 'parts may pay part of the sale');
  assert.equal(splitProblem([part('cash', 3000), part('mobile', 1000, 'b'), part('mobile', 1000, 'm'), part('bank', 600, 's')]), null, 'four places under the total');
  assert.equal(splitProblem([part('cash', 3400), part('mobile', 2000, 'b'), part('mobile', 1000, 'm'), part('bank', 600, 's')]), null, 'four places paying it all');
  assert.equal(splitProblem([part('cash', 3000), part('mobile', 1000, 'a'), part('mobile', 1000, 'b'), part('mobile', 1000, 'c'), part('mobile', 1000, 'd')]), 'too_many');
  assert.equal(splitProblem([part('cash', 3000), part('cash', 4000)]), 'duplicate');
  assert.equal(splitProblem([part('mobile', 3000, 'b'), part('bank', 4000, 'b')]), 'duplicate');
  assert.equal(splitProblem([part('mobile', 3000, 'ab12'), part('mobile', 2000, 'AB12')]), 'duplicate', 'one account written two ways is one place');
  assert.equal(splitProblem([part('cash', 3000), part('mobile', 0, 'b')]), 'empty_part');
  assert.equal(splitProblem([part('cash', 3000), part('mobile', '.', 'b')]), 'empty_part', 'a lone decimal point is no amount');
  assert.equal(splitProblem([part('cash', 3000), part('mobile', '', 'b')]), 'empty_part', 'nor is a blank field');
  assert.equal(splitProblem([part('cash', 3000), part('mobile', -5, 'b')]), 'empty_part');
  assert.equal(splitProblem([part('cash', 7000)]), null, 'one part');
  assert.deepEqual(nextFreeSource([part('cash', 1)], ['b', 'm']), { kind: 'account', accountId: 'b' });
  assert.deepEqual(nextFreeSource([part('mobile', 1, 'b')], ['b', 'm']), { kind: 'cash' });
  assert.equal(nextFreeSource([part('cash', 1), part('mobile', 1, 'b')], ['b']), null);
  assert.equal(nextFreeSource([part('cash', 1), part('mobile', 1, 'AB12')], ['ab12']), null, 'the same account whatever its letter case');
});
it('a split that pays part of the sale: paid + owed is the sale amount, and the status says which', () => {
  for (const amounts of [[3000, 2000], [3000, 1000, 1000, 600], [3400, 2000, 1000, 600], [1500.5, 499.5]]) {
    const paid = amounts.reduce((sum, a) => sum + a, 0);
    const { remaining, status } = previewSalePayment(7000, paid);
    assert.equal(Math.round((paid + remaining) * 100) / 100, 7000, amounts.join(' + '));
    assert.equal(status, remaining === 0 ? 'paid' : 'partial', amounts.join(' + '));
  }
});
it('a split part keeps its amount as typed, and nothing empty is sent', () => {
  assert.match(sheet, /const \[parts, setParts\] = useState<SplitPart\[\]>\(\[\]\);/);
  assert.match(sheet, /parts\.map\(\(\{ amountText, \.\.\.part \}\) => \(\{ \.\.\.part, amount: Number\(amountText\) \}\)\)/);
  assert.match(sheet, /value=\{entry\.amountText\}/);
  assert.match(sheet, /\{ \.\.\.x, amountText: text \}/);
  assert.match(sheet, /split\.map\(\(entry\) => \(\{\s*\.\.\.entry,/);
});
it('the review names each part when more than one is sent; one part or one method keeps the one-method sentence', () => {
  assert.match(sheet, /split\.length > 1\s*\?\s*t\('sellDebt\.review\.bodySplit', \{/);
  assert.match(sheet, /parts: split\.map\(\(entry\) => `\$\{labelOf\(sourceOf\(entry\)\)\} \$\{isolateLtr\(formatMoney\(entry\.amount, \{ decimals \}\)\)\}`\)\.join\(' \+ '\)/);
  assert.match(sheet, /:\s*t\('sellDebt\.review\.body', \{\s*received: formatMoney\(paid, \{ decimals \}\),\s*method: isSplitting && split\[0\] \? labelOf\(sourceOf\(split\[0\]\)\) : sourceLabel,/);
  assert.match(read('./i18n/en.ts'), /'sellDebt\.review\.bodySplit': "\{received\} received now: \{parts\}\. \{remaining\} will be owed by \{name\}\."/);
});
it('an amount past two decimals — or under 0.01 — is never sent: Complete waits, and the sheet says why', () => {
  assert.equal(amountProblem(''), 'empty');
  assert.equal(amountProblem('.'), 'empty', 'an amount on its way');
  assert.equal(amountProblem('0'), 'empty');
  assert.equal(amountProblem('0.01'), null);
  assert.equal(amountProblem('1500.5'), null);
  assert.equal(amountProblem('1500.55'), null);
  assert.equal(amountProblem('1500.555'), 'bad_amount');
  assert.equal(amountProblem('0.001'), 'bad_amount', 'under 0.01 is past two decimals');
  const part = (method: string, amountText: string, receivingAccountId?: string) => ({ method, amountText, receivingAccountId });
  assert.equal(splitProblem([part('cash', '3000'), part('mobile', '1000.555', 'b')]), 'bad_amount');
  assert.equal(splitProblem([part('cash', '0.005'), part('mobile', '2000', 'b')]), 'bad_amount');
  assert.equal(splitProblem([part('cash', '3000.25'), part('mobile', '1000.5', 'b')]), null);
  assert.equal(splitProblem([part('cash', ''), part('mobile', '1000.555', 'b')]), 'empty_part', 'a part still to type is said first');
  // One method or a split, the same judgement, first in line: Complete waits, and the line says two decimals at most.
  assert.match(sheet, /const amountBad = isSplitting \? splitIssue === 'bad_amount' : amountProblem\(receivedText\) === 'bad_amount';/);
  assert.match(sheet, /\{amountBad \? \(\s*<Text variant="caption" tone="tertiary" align="center">\s*\{t\('closeDay\.count\.invalid'\)\}\s*<\/Text>\s*\) : overpaid \?/);
  for (const locale of ['en', 'fr', 'ar']) assert.ok(read(`./i18n/${locale}.ts`).includes("'closeDay.count.invalid':"), locale);
});
it('the last split part can be removed: back to one method, with that part’s amount and place', () => {
  const remove = sheet.slice(sheet.indexOf('const removeSplitRow'), sheet.indexOf('const accountsFor'));
  assert.match(remove, /const last = parts\.length === 1 && parts\[0\]\.key === key \? parts\[0\] : null;\s*if \(last\) \{\s*setReceivedText\(last\.amountText\);\s*setSource\(sourceOf\(last\)\);\s*\}/);
  const button = sheet.slice(sheet.indexOf('icon={X}'), sheet.indexOf('/>', sheet.indexOf('icon={X}')));
  assert.match(button, /onPress=\{\(\) => removeSplitRow\(entry\.key\)\}/);
  assert.ok(!/disabled=/.test(button), 'no part is held on screen');
});
it('a split opens on the amount already typed as received, when the sale can take it; else on the total', () => {
  assert.match(sheet, /const typed = Number\(receivedText\);[\s\S]*?amountText: Number\.isFinite\(typed\) && typed > 0 && typed <= total \? receivedText : String\(total\),/);
});
it('with cents anywhere, every figure of the sheet shows them, so received and owed add up to the total shown', () => {
  assert.match(sheet, /const decimals = \[total, paid, remaining, \.\.\.split\.map\(\(entry\) => entry\.amount\)\]\.some\(\(v\) => Number\.isFinite\(v\) && Math\.round\(v \* 100\) % 100 !== 0\) \? 2 : 0;/);
  const calls = sheet.match(/formatMoney\([^()]*\)/g) ?? [];
  assert.ok(calls.length >= 9, `expected every figure, found ${calls.length}`);
  for (const call of calls) assert.match(call, /, \{ decimals \}\)$/, call);
  assert.match(sheet, /<MoneyValue value=\{total\} size="large" decimals=\{decimals\} \/>/);
  assert.match(sheet, /<MoneyValue value=\{remaining\} size="large" decimals=\{decimals\} \/>/);
  // 1 500,50 received of 7 000 leaves 5 499,50: whole units would print 1 501 + 5 500, which is not 7 000.
  const shown = (v: number, decimals: number) => Number(formatMoney(v, { decimals, showCurrency: false }).replace(/\s/g, '').replace(',', '.'));
  const { remaining } = previewSalePayment(7000, 1500.5);
  assert.equal(shown(1500.5, 2) + shown(remaining, 2), shown(7000, 2));
  assert.notEqual(shown(1500.5, 0) + shown(remaining, 0), shown(7000, 0));
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
  '../components/money/SetStartingAmountSheet.tsx',
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
