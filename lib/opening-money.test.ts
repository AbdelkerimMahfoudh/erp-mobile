/**
 * The money a shop opens with (docs/63): the Owner's explicit choice, a set amount
 * typed or chosen as 0 — never an empty field taken for 0 — an unknown amount kept
 * unknown, and the same request again sent under the same key.
 *
 *   node lib/opening-money.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  attemptKey,
  openingDraft,
  openingMethodsOf,
  openingRequest,
  openingTotal,
  prefilledCash,
  type OpeningMethod,
  keepAvailable,
  keepUnavailableReason,
} from './opening-money.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
};
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const code = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const method = (over: Partial<OpeningMethod> & Pick<OpeningMethod, 'key' | 'channel'>): OpeningMethod => ({
  accountId: over.channel === 'account' ? over.key : null,
  label: over.key,
  scope: over.channel === 'cash' ? 'branch' : 'company',
  known: over.previous !== null,
  previous: 0,
  ...over,
});
const cash = (previous: number | null) => method({ key: 'cash', channel: 'cash', previous, known: previous !== null });
const account = (key: string, previous: number | null) => method({ key, channel: 'account', previous, known: previous !== null });

it('nothing is chosen for the Owner: no choice, nothing to send', () => {
  assert.deepEqual(openingDraft(null, '3400'), { ok: false, reason: 'choose' });
  assert.equal(openingRequest(openingDraft(null, ''), 'k', true), undefined);
});

it('keep needs something to keep: an unknown drawer offers no keep, and the amount is the only decision (2026-10-06)', () => {
  const unknown: OpeningMethod[] = [{ key: 'cash', channel: 'cash', accountId: null, label: '', scope: 'branch', known: false, previous: null }];
  const known: OpeningMethod[] = [{ key: 'cash', channel: 'cash', accountId: null, label: '', scope: 'branch', known: true, previous: 3400 }];
  assert.equal(keepAvailable(unknown), false);
  assert.equal(keepAvailable(known), true);
  assert.equal(keepAvailable([]), false);
  assert.deepEqual(openingDraft('keep', '', false), { ok: false, reason: 'keep_unavailable' });
  assert.deepEqual(openingDraft('keep', '', true), { ok: true, decision: 'keep' });
  // Set still needs a typed amount — an unknown drawer is not quietly zeroed.
  assert.deepEqual(openingDraft('set', '', false), { ok: false, reason: 'amount_required' });
  assert.deepEqual(openingDraft('set', '0', false), { ok: true, decision: 'set', cashAmount: 0 });
  // The server's refusal of a keep it cannot honour is said in the sheet's own words.
  assert.match(code(read('../components/day/useOpeningFlow.tsx')), /opening_cash_unknown/);
  assert.match(code(read('../app/(tabs)/money-hub.tsx')), /opening_cash_unknown/);
});

it('keep sends the decision alone — the server keeps the drawer as it tracks it', () => {
  assert.deepEqual(openingDraft('keep', ''), { ok: true, decision: 'keep' });
  assert.deepEqual(openingRequest(openingDraft('keep', 'ignored'), 'k1', true), { clientUuid: 'k1', decision: 'keep' });
});

it('set needs an amount: empty is not 0; 0 is valid when typed; a bad amount is refused', () => {
  assert.deepEqual(openingDraft('set', ''), { ok: false, reason: 'amount_required' });
  assert.deepEqual(openingDraft('set', '   '), { ok: false, reason: 'amount_required' });
  assert.deepEqual(openingDraft('set', '0'), { ok: true, decision: 'set', cashAmount: 0 });
  assert.deepEqual(openingDraft('set', '3,400'), { ok: true, decision: 'set', cashAmount: 3400 });
  assert.deepEqual(openingDraft('set', '٣٤٠٠'), { ok: true, decision: 'set', cashAmount: 3400 }, 'the Arabic keyboard’s digits');
  for (const bad of ['-5', 'abc', '1.234']) assert.deepEqual(openingDraft('set', bad), { ok: false, reason: 'amount_invalid' }, bad);
  assert.deepEqual(openingRequest(openingDraft('set', '0'), 'k2', true), { clientUuid: 'k2', decision: 'set', cashAmount: 0 });
});

it('anybody but the Owner sends only the key: the server carries the amounts and marks the day for review', () => {
  assert.deepEqual(openingRequest(openingDraft(null, ''), 'k3', false), { clientUuid: 'k3' });
  assert.deepEqual(openingRequest(openingDraft('set', '100'), 'k3', false), { clientUuid: 'k3' }, 'never a decision, whatever the state');
});

it('the set field starts from the drawer’s known amount — an unknown drawer starts empty, never at 0', () => {
  assert.equal(prefilledCash([cash(3400), account('bankily', 3600)]), '3400');
  assert.equal(prefilledCash([cash(null), account('bankily', 3600)]), '');
  assert.equal(prefilledCash([account('bankily', 3600)]), '');
});

it('the total: 3,400 in cash and 3,600 in the accounts is 7,000; setting the cash changes only the cash', () => {
  const methods = [cash(3400), account('bankily', 2600), account('masrvi', 1000)];
  assert.equal(openingTotal(methods, openingDraft('keep', '')), 7000);
  assert.equal(openingTotal(methods, openingDraft(null, '')), 7000, 'before choosing, the amounts as they carry');
  assert.equal(openingTotal(methods, openingDraft('set', '0')), 3600, 'an emptied drawer; the accounts carry forward');
  assert.equal(openingTotal(methods, openingDraft('set', '500.25')), 4100.25);
});

it('an unknown amount keeps the total unknown — until the Owner sets the cash, when only the accounts can hold it back', () => {
  assert.equal(openingTotal([cash(null), account('bankily', 3600)], openingDraft('keep', '')), null);
  assert.equal(openingTotal([cash(null), account('bankily', 3600)], openingDraft('set', '3400')), 7000);
  assert.equal(openingTotal([cash(3400), account('bankily', null)], openingDraft('set', '0')), null, 'a shop’s opening never sets a company account');
});

it('the same request again keeps its key; a changed request gets a new one', () => {
  let n = 0;
  const next = () => `key-${++n}`;
  const first = attemptKey(null, 'A', next);
  assert.deepEqual(first, { key: 'key-1', payload: 'A' });
  assert.equal(attemptKey(first, 'A', next), first, 'a retry or a second tap');
  assert.deepEqual(attemptKey(first, 'B', next), { key: 'key-2', payload: 'B' });
});

it('Money’s methods become the step’s, the position as the previous amount — unknown stays null', () => {
  const methods = openingMethodsOf([
    { key: 'cash', channel: 'cash', accountId: null, label: 'Cash', scope: 'branch', known: false, position: null },
    { key: 'a1', channel: 'account', accountId: 'a1', label: 'Bankily', scope: 'company', known: true, position: 3600 },
  ]);
  assert.deepEqual(methods.map((m) => [m.key, m.previous, m.known]), [['cash', null, false], ['a1', 3600, true]]);
});

it('the sheet: no choice until the Owner makes one, Set to 0 as its own action, the error kept in place', () => {
  const sheet = code(read('../components/day/OpeningMoneySheet.tsx'));
  // Nothing chosen for the Owner — unless there is nothing to keep, when the amount is the only decision (2026-10-06).
  assert.match(sheet, /const keepPossible = !mayDecide \|\| keepUnavailable === null;/);
  assert.match(sheet, /const \[choice, setChoice\] = useState<OpeningChoice \| null>\(keepPossible \? null : 'set'\);/);
  assert.match(sheet, /const draft = openingDraft\(choice, cash, keepPossible\);/);
  assert.match(sheet, /: mayDecide && !keepPossible \? \(\s*<InlineNotice tone="warning" title=\{t\('opening\.keep\.unavailable\.title'\)\}/);
  assert.match(sheet, /if \(next === 'set' && choice !== 'set'\) setCash\(prefilledCash\(methods\)\);/);
  assert.match(sheet, /onPress=\{\(\) => setCash\('0'\)\}/);
  assert.match(sheet, /disabled=\{busy \|\| \(mayDecide && !draft\.ok\)\}/);
  assert.match(sheet, /\{error \? <InlineNotice tone="danger">\{error\}<\/InlineNotice> : null\}/);
  // Anybody but the Owner sees only the drawer they open with — the accounts are the Owner's (TM-3).
  assert.match(sheet, /const shown = mayDecide \? methods : methods\.filter\(\(m\) => m\.channel === 'cash'\);/);
  assert.match(sheet, /attempt\.current = attemptKey\(attempt\.current, payload, uuidv4\);/);
});

it('the flow: a refusal keeps the sheet open with its values; an older server gets the opening it knows', () => {
  const flow = code(read('../components/day/useOpeningFlow.tsx'));
  assert.match(flow, /catch \(e\) \{\s*const message = [^;]+;\s*setError\(message\);/);
  assert.ok(!/catch \(e\) \{[^}]*setStage\('idle'\)/.test(flow), 'a refusal does not close the sheet');
  assert.match(flow, /if \(day\?\.openingMoney\) \{\s*setStage\(afterDaySheet \? 'toMoney' : 'money'\);\s*return;\s*\}/);
  assert.match(flow, /\.\.\.\(openingMoney \? \{ openingMoney \} : \{\}\)/);
  // The day chosen before 06:00 is a step, not the opening: its button says Next while the amounts follow, and a day
  // started early is opened for the first time.
  assert.match(flow, /confirmLabel=\{step \? t\('action\.next'\) : undefined\}/);
  assert.match(flow, /intent=\{mode === 'start_new' \? 'open' : intent\}/);
  // A sheet's close arrives after its exit animation: the day sheet's must not close the amounts that followed it.
  assert.match(flow, /const closed = \(which: 'day' \| 'money'\) => \(\) => setStage\(\(s\) => \(s === which \? 'idle' : s\)\);/);
  assert.match(flow, /open=\{stage === 'day'\}\s*onClose=\{closed\('day'\)\}/);
  assert.match(flow, /open=\{stage === 'money'\}\s*onClose=\{closed\('money'\)\}/);
  assert.ok(!/setStage\('idle'\)\}/.test(flow), 'no sheet resets the flow unconditionally');
  assert.match(code(read('../components/closing/DayChoiceSheet.tsx')), /<Button title=\{confirmLabel \?\? t\(k\('confirm'\)\)\}/);
});

it('one modal at a time: the amounts only once the day sheet’s modal is gone (the iPhone, 01:09 on 29 Sep)', () => {
  const flow = code(read('../components/day/useOpeningFlow.tsx'));
  // The day chosen, the flow waits (toMoney) while its sheet leaves; the sheet's own dismissal moves it on.
  assert.match(flow, /const daySheetGone = \(\) => setStage\(\(s\) => \(s === 'toMoney' \? 'money' : s\)\);/);
  assert.match(flow, /onClose=\{closed\('day'\)\}\s*onDismissed=\{daySheetGone\}/);
  assert.match(flow, /onConfirm=\{\(chosen\) => void amounts\(chosen, true\)\}/);
  // No dialog behind a sheet: the older server's reopen dialog only when no day sheet came first.
  assert.match(flow, /if \(intent === 'reopen' && !afterDaySheet\) \{/);
  // The sheet waits for UIKit: the same Modal, hidden, until its dismissal is reported — then onDismissed.
  const sheet = code(read('../components/overlay/BottomSheet.tsx'));
  assert.match(sheet, /setMounted\(false\);\s*onClose\(\);\s*if \(Platform\.OS === 'ios'\) setDismissing\(true\);\s*else onDismissed\?\.\(\);/);
  assert.match(sheet, /return dismissing \? <Modal visible=\{false\} transparent statusBarTranslucent animationType="none" onDismiss=\{dismissed\} \/> : null;/);
  // Never stuck: a modal never presented reports no dismissal, so a short wait stands in for it.
  assert.match(sheet, /const fallback = setTimeout\(dismissed, DISMISS_REPORT_TIMEOUT_MS\);/);
  // Asked to open while still leaving, it opens once gone.
  assert.match(sheet, /if \(open\) \{\s*if \(dismissing\) return;/);
  assert.match(sheet, /const dismissed = useCallback\(\(\) => \{\s*setDismissing\(false\);\s*onDismissed\?\.\(\);\s*\}, \[onDismissed\]\);/);
});

it('a failure keeps the chosen day, the amounts and the key; only a success starts afresh', () => {
  const flow = code(read('../components/day/useOpeningFlow.tsx'));
  assert.match(flow, /setError\(message\);\s*setFailed\(true\);/);
  assert.match(flow, /setStage\('idle'\);\s*setFailed\(false\);/);
  assert.match(flow, /if \(!failed\) setNonce\(\(n\) => n \+ 1\);/);
  // The sheets are keyed by that nonce: not remounted after a failure, their choice, amount and key stay.
  assert.match(flow, /<OpeningMoneySheet\s+key=\{`money-\$\{nonce\}`\}/);
  const sheet = code(read('../components/day/OpeningMoneySheet.tsx'));
  assert.match(sheet, /const attempt = useRef<\{ key: string; payload: string \} \| null>\(null\);/);
  // Before 06:00 a staff member reads which day runs in the sheet itself.
  assert.match(sheet, /\{notice \? <InlineNotice tone="info">\{notice\}<\/InlineNotice> : null\}/);
});

it('the words: the final action says what it does, and Keep, Set, Unknown in every language', () => {
  const keys = ['opening.keep.title', 'opening.set.title', 'opening.setZero', 'opening.unknown', 'opening.confirm', 'opening.confirm.carried', 'opening.confirm.review', 'opening.total', 'opening.accounts.note', 'opening.keep.unavailable.title', 'opening.keep.unavailable.body'];
  for (const locale of ['en', 'fr', 'ar']) {
    const cat = read(`./i18n/${locale}.ts`);
    for (const k of keys) assert.ok(cat.includes(`'${k}':`), `${locale} is missing ${k}`);
  }
  const en = read('./i18n/en.ts');
  assert.match(en, /'opening\.confirm': 'Confirm amounts and open the boutique'/);
  assert.match(en, /'opening\.keep\.title': 'Keep the previous amounts'/);
  assert.match(en, /'opening\.set\.title': 'Set today’s opening amounts'/);
});

console.log(`opening-money: ${passed} passed`);

it('a drawer tracked below zero cannot be kept either (2026-10-08): its own reason, no prefilled amount, no total until set', () => {
  const negative = [cash(-1231250), account('account:b', 2600)];
  assert.equal(keepUnavailableReason(negative), 'negative');
  assert.equal(keepAvailable(negative), false);
  assert.equal(keepUnavailableReason([cash(null)]), 'unknown');
  assert.equal(keepUnavailableReason([cash(0)]), null);
  assert.equal(keepUnavailableReason([cash(3400)]), null);
  assert.equal(prefilledCash(negative), '');
  assert.equal(openingTotal(negative, { ok: false, reason: 'choose' }), null);
  assert.equal(openingTotal(negative, { ok: true, decision: 'set', cashAmount: 1000 }), 3600);
  // The sheet says why in its own words, and the server's refusal is read by name.
  const sheet = code(read('../components/day/OpeningMoneySheet.tsx'));
  assert.match(sheet, /keepUnavailable === 'negative'/);
  assert.match(sheet, /opening\.keep\.negative\.body/);
  assert.match(code(read('../components/day/useOpeningFlow.tsx')), /opening_cash_negative/);
  assert.match(code(read('../app/(tabs)/money-hub.tsx')), /opening_cash_negative/);
});
