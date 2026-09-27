/**
 * The counter's lock (2026-09-27, docs/59 D76): Sell and Receive wait while the
 * boutique's current business day is closed, and Open store now is offered to
 * those who may reopen it. A lock that comes after the screen was shown covers
 * it rather than unmounting it, so a refused sale or receipt loses nothing.
 *
 *   node lib/day-gate.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { closedDayOf, dayGate, isStoreClosedRefusal } from './day-gate.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok - ${name}`);
};
type Standing = 'open' | 'counting' | 'counted' | 'closed' | 'reopened' | 'needs_review' | 'inactive';
const day = (standing: Standing = 'closed') => ({ standing, businessDate: '2026-09-27' });

it('the current business day closed: locked, and the Owner or a named delegate may open the store', () => {
  assert.deepEqual(dayGate(day(), true), { locked: true, mayOpen: true, businessDate: '2026-09-27' });
});

it('somebody without the closing authority sees the lock and is told who can open it', () => {
  assert.deepEqual(dayGate(day(), false), { locked: true, mayOpen: false, businessDate: '2026-09-27' });
});

it('open, counting, counted and reopened days never lock the counter; nor does a day never opened', () => {
  for (const standing of ['open', 'counting', 'counted', 'reopened'] as const) assert.deepEqual(dayGate(day(standing), true), { locked: false });
});

it('no view — not loaded, failed, or not for this person — never locks anybody out: the server’s rule stands', () => {
  assert.deepEqual(dayGate(null, true), { locked: false });
  assert.deepEqual(dayGate(undefined, false), { locked: false });
});

it('the rule reads the server’s business day, never the phone’s clock', () => {
  const src = readFileSync(new URL('./day-gate.ts', import.meta.url), 'utf8');
  assert.ok(!/new Date\(|Date\.now\(/.test(src));
});

it('Home and the guard ask the light business-day view, only for those it is for, and never trust a cached answer for anyone else', () => {
  const home = readFileSync(new URL('../app/(tabs)/index.tsx', import.meta.url), 'utf8');
  const gate = readFileSync(new URL('../components/day/DayGate.tsx', import.meta.url), 'utf8');
  for (const src of [home, gate]) {
    assert.match(src, /useBusinessDay\(\{ enabled: [^}]*canCount[^}]*\}\)/);
    assert.match(src, /dayGate\(canCount \? [a-zA-Z]+\.data : undefined, canPerform\)/);
  }
  // The full day view (for the choice sheet) is read only once the counter is locked, inside Open store now.
  const open = readFileSync(new URL('../components/day/OpenStoreNow.tsx', import.meta.url), 'utf8');
  assert.match(open, /const view = useOpenClosing\(undefined, \{ enabled: mayOpen \}\);/);
});

const refusal = (status: number, code?: string) =>
  Object.assign(new Error('The store is closed for business day 2026-09-27. Nothing was sold.'), { status, code });

it('the server’s closed-store refusal is known by its status and code, never by its sentence', () => {
  assert.equal(isStoreClosedRefusal(refusal(409, 'store_closed')), true);
  assert.equal(isStoreClosedRefusal(refusal(409)), false);
  assert.equal(isStoreClosedRefusal(refusal(409, 'idempotency_conflict')), false);
  assert.equal(isStoreClosedRefusal(refusal(400, 'store_closed')), false);
  assert.equal(isStoreClosedRefusal(new TypeError('Network request failed')), false);
  assert.equal(isStoreClosedRefusal(undefined), false);
  assert.equal(isStoreClosedRefusal(null), false);
});

const code = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const screen = (p: string) => code(readFileSync(new URL(p, import.meta.url), 'utf8'));

it('a lock found on the first read stands in for the screen; one that comes later covers it, and the screen stays mounted beneath', () => {
  const gate = screen('../components/day/DayGate.tsx');
  assert.match(gate, /const \[shown, setShown\] = useState\(false\);\s*if \(!shown && !reading && !gate\.locked\) setShown\(true\);\s*const covered = shown && gate\.locked;/);
  assert.match(gate, /if \(!shown && gate\.locked\) return <DayClosedScreen businessDate=\{gate\.businessDate\} mayOpen=\{gate\.mayOpen\} backRoute=\{backRoute\} \/>;/);
  // One tree, covered or not, so the lock coming up never remounts the screen: nothing typed is lost.
  assert.match(
    gate,
    /return \(\s*<View style=\{styles\.fill\}>\s*<View\s+style=\{styles\.fill\}\s+pointerEvents=\{covered \? 'none' : 'auto'\}\s+aria-hidden=\{covered\}\s+accessibilityElementsHidden=\{covered\}\s+importantForAccessibility=\{covered \? 'no-hide-descendants' : 'auto'\}\s*>\s*\{children\}\s*<\/View>\s*\{gate\.locked \? \(\s*<View style=\{\[StyleSheet\.absoluteFill, styles\.cover\]\}>\s*<DayClosedScreen businessDate=\{gate\.businessDate\} mayOpen=\{gate\.mayOpen\} backRoute=\{backRoute\} \/>/,
  );
  assert.equal(gate.match(/\{children\}/g)?.length, 1, 'the screen is rendered in one place only');
  assert.match(gate, /cover: \{ backgroundColor: colors\.surface\.canvas \}/);
  assert.match(gate, /useEffect\(\(\) => \{\s*if \(covered\) Keyboard\.dismiss\(\);\s*\}, \[covered\]\);/);
});

// The toast and the day read again (and Home with it), nothing else: the guard covers the screen, whose draft stays as it was beneath.
const readsDayAgain = String.raw`\s*qc\.invalidateQueries\(\{ queryKey: qk\.businessDay\(branchId\) \}\);\s*qc\.invalidateQueries\(\{ queryKey: qk\.home\(branchId\) \}\);\s*return;`;

it('a sale refused on a closed day says so and reads the day again, so the lock and Open store now appear', () => {
  for (const file of ['../app/quick-sell.tsx', '../app/(tabs)/sell.tsx']) {
    const src = screen(file);
    assert.match(src, new RegExp(String.raw`case 'store_closed':\s*toast\.error\(t\('gate\.refused\.sale'\)\);` + readsDayAgain), file);
    // The below-cost question still follows the named refusals.
    assert.match(src, /e\.status === 400 && \/reason\/i\.test\(e\.message\) && !options\.overrideReason/, file);
  }
});

it('a receipt refused on a closed day says so and reads the day again; the key-conflict answer stays', () => {
  for (const file of ['../app/quick-receive.tsx', '../app/receive.tsx', '../app/receive/file.tsx']) {
    const src = screen(file);
    assert.match(src, new RegExp(String.raw`if \(isStoreClosedRefusal\(e\)\) \{\s*toast\.error\(t\('gate\.refused\.receive'\)\);` + readsDayAgain + String.raw`\s*\}`), file);
  }
  for (const file of ['../app/quick-receive.tsx', '../app/receive.tsx']) {
    assert.match(screen(file), /if \(e instanceof ApiError && e\.status === 409 && \/already used\/i\.test\(e\.message\)\) \{\s*void dialog\.alert\(\{ title: t\('receive\.uncertain\.title'\), message: t\('receive\.keyConflict'\) \}\);\s*return;\s*\}\s*if \(isStoreClosedRefusal\(e\)\)/, file);
  }
});

it('both refusals are written in every language', () => {
  for (const locale of ['en', 'fr', 'ar']) {
    const src = readFileSync(new URL(`./i18n/${locale}.ts`, import.meta.url), 'utf8');
    for (const key of ['gate.refused.sale', 'gate.refused.receive']) assert.match(src, new RegExp(String.raw`'${key.replace(/\./g, '\\.')}': '[^']+'`), `${locale}: ${key}`);
  }
});

it('the closed day a refusal names comes from its field, never from its sentence', () => {
  const answer = (status: number, code: string, body?: unknown) => Object.assign(new Error('The store is closed for business day 2026-09-27.'), { status, code, body });
  assert.equal(closedDayOf(answer(409, 'store_closed', { code: 'store_closed', businessDate: '2026-09-27' })), '2026-09-27');
  assert.equal(closedDayOf(answer(409, 'store_closed', { code: 'store_closed' })), null, 'no field, no date — the sentence is never read');
  assert.equal(closedDayOf(answer(409, 'store_closed', { businessDate: 'yesterday' })), null);
  assert.equal(closedDayOf(answer(409, 'day_already_closed', { businessDate: '2026-09-27' })), null);
  assert.equal(closedDayOf(undefined), null);
});

it('a later payment refused on a closed day keeps the form and offers to open the store, then lets it be sent again (docs/61)', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const pay = code(read('../app/sales/pay/[id].tsx'));
  assert.match(pay, /const closedDay = closedDayOf\(record\.error\);/);
  assert.match(pay, /const mayOpen = usePermission\('closing\.perform'\);/);
  assert.match(pay, /<InlineNotice tone="danger" title=\{t\('gate\.closed\.title'\)\}>\s*\{t\('recordPayment\.storeClosed'\)\}/);
  assert.match(pay, /<OpenStoreNow\s+businessDate=\{closedDay\}\s+mayOpen=\{mayOpen\}\s+closedText=\{t\('recordPayment\.storeClosed\.open', \{ date: formatDate\(closedDay\) \}\)\}\s+onOpened=\{\(\) => record\.reset\(\)\}/);
  // Nothing clears the typed payment on a refusal: the fields are only set by the person.
  assert.ok(!/setAmount\(''\)|setNote\(''\)|setReference\(''\)/.test(pay), 'the form is never cleared by a refusal');
  const hook = code(read('./money-overview.ts'));
  // The request key changes only on success, so the retry after opening is the same payment, not a second one.
  assert.match(hook, /onSuccess: \(\) => \{\s*key\.current = uuidv4\(\);/);
  assert.match(hook, /onError: \(e\) => \{\s*if \(isStoreClosedRefusal\(e\)\) \{\s*void qc\.invalidateQueries\(\{ queryKey: qk\.businessDay\(branchId\) \}\);/);
  const open = code(read('../components/day/OpenStoreNow.tsx'));
  assert.match(open, /setSheet\(false\);\s*onOpened\?\.\(\);/);
  assert.match(open, /\{mayOpen \? \(closedText \?\? t\('home\.store\.closed', \{ date \}\)\) : t\('home\.store\.noPermission', \{ date \}\)\}/);
  for (const locale of ['en', 'fr', 'ar']) {
    const src = read(`./i18n/${locale}.ts`);
    for (const key of ['recordPayment.storeClosed', 'recordPayment.storeClosed.open']) assert.match(src, new RegExp(String.raw`'${key.replace(/\./g, '\\.')}': '[^']+'`), `${locale}: ${key}`);
  }
});

console.log(`day-gate: ${passed} passed`);
