/**
 * Partners: the tab, the sections, the badge — and that Sell did not get lost.
 *
 *   node lib/partners.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
  incomingNeedingAction,
  isCompleteStoreCode,
  loanMove,
  normaliseStoreCode,
  partnerSections,
  type PartnerRowLike,
} from './partners.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  try { fn(); passed++; } catch (e) { console.error(`✗ ${name}`); throw e; }
};
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const stripComments = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const row = (over: Partial<PartnerRowLike>): PartnerRowLike => ({
  id: Math.random().toString(36).slice(2), status: 'pending', direction: 'outgoing', canDecide: false, ...over,
});

// ── sections and badge ──────────────────────────────────────────────────────

it('sorts connections into received, connected, sent and past', () => {
  const s = partnerSections([
    row({ status: 'accepted' }),
    row({ status: 'pending', direction: 'incoming', canDecide: true }),
    row({ status: 'pending', direction: 'outgoing' }),
    row({ status: 'removed' }),
    row({ status: 'rejected' }),
    row({ status: 'cancelled' }),
    row({ status: 'blocked' }),
  ]);
  assert.equal(s.connected.length, 1);
  assert.equal(s.received.length, 1);
  assert.equal(s.sent.length, 1);
  assert.equal(s.past.length, 4, 'ended relationships stay listed — their history is still readable');
});

it('the badge counts only incoming requests this user can decide', () => {
  const rows = [
    row({ status: 'pending', direction: 'incoming', canDecide: true }),
    row({ status: 'pending', direction: 'incoming', canDecide: true }),
    row({ status: 'pending', direction: 'outgoing' }),
    row({ status: 'accepted', direction: 'incoming' }),
  ];
  assert.equal(incomingNeedingAction(rows, true), 2);
});

it('no badge for a user who may not manage connections', () => {
  assert.equal(incomingNeedingAction([row({ direction: 'incoming', canDecide: true })], false), 0);
  assert.equal(incomingNeedingAction(undefined, true), 0);
});

it('store codes are normalised the way people type them', () => {
  assert.equal(normaliseStoreCode('e301 c77-b79'), 'E301C77B79');
  assert.equal(isCompleteStoreCode('E301C77B79'), true);
  assert.equal(isCompleteStoreCode('E301C77B7'), false);
});

it('a loan waiting on us reads as your move', () => {
  assert.equal(loanMove('us'), 'you');
  assert.equal(loanMove('them'), 'them');
});

// ── the tab bar ─────────────────────────────────────────────────────────────

const TABS = read('../app/(tabs)/_layout.tsx');

it('the bar is Home · Partners · Money · Stock · More', () => {
  const src = stripComments(TABS);
  const screens = [...src.matchAll(/<Tabs\.Screen\s+name="([a-z-]+)"([\s\S]*?)\/>/g)];
  const visible = screens.filter(([, , body]) => !/href:\s*null\s*[,}]/.test(body)).map(([, n]) => n);
  assert.deepEqual(visible, ['index', 'partners', 'money-hub', 'inventory', 'more']);
});

it('Sell is no longer a tab, but its route is still declared, hidden', () => {
  const src = stripComments(TABS);
  const sell = src.match(/<Tabs\.Screen\s+name="sell"([\s\S]*?)\/>/);
  assert.ok(sell, 'the sell route must stay registered so links and the saved cart keep working');
  assert.match(sell[1], /href:\s*null/);
  assert.ok(existsSync(new URL('../app/(tabs)/sell.tsx', import.meta.url)), 'the full selling screen still exists');
});

it('Partners carries a badge for requests awaiting this user', () => {
  assert.match(TABS, /tabBarBadge/);
  assert.match(TABS, /incomingNeedingAction\(/);
});

it('the Partners tab label is translated in all three languages', () => {
  const expect = { en: 'Partners', fr: 'Partenaires', ar: 'الشركاء' } as const;
  for (const [lang, label] of Object.entries(expect)) {
    const cat = read(`./i18n/${lang}.ts`);
    assert.ok(cat.includes(`'tab.partners': '${label}'`), `${lang} must label the tab ${label}`);
  }
});

// ── full Sell stays reachable, and old links resolve ────────────────────────

it('Home links to the full sale, so a multi-item cart is never stranded', () => {
  const home = read('../app/(tabs)/index.tsx');
  assert.match(home, /\/\(tabs\)\/sell/);
});

it('Quick Sell offers the full sale too', () => {
  assert.match(read('../app/quick-sell.tsx'), /\/\(tabs\)\/sell/);
});

it('the full sell screen still keeps its cart draft under the same key', () => {
  assert.match(read('../app/(tabs)/sell.tsx'), /useDraft<CartLine\[\]>\('sell\.cart'/);
});

it('the old /stores link still resolves, to Partners', () => {
  const stores = read('../app/stores/index.tsx');
  assert.match(stores, /Redirect/);
  assert.match(stores, /\/\(tabs\)\/partners/);
});

it('a connected store has its own screen', () => {
  assert.ok(existsSync(new URL('../app/partners/[id].tsx', import.meta.url)));
});

// ── the direct-sale gap is stated, never faked ──────────────────────────────

it('"Sell to this store" does not create an ordinary customer sale', () => {
  const detail = stripComments(read('../app/partners/[id].tsx'));
  assert.ok(!/\/sales['"`]/.test(detail) && !/api\.post[^;]*\/sales/.test(detail), 'no retail sale may stand in for an inter-store one');
  assert.match(detail, /partners\.action\.sell\.unavailable/);
});

it('money owed each way and custody each way are shown separately', () => {
  const detail = read('../app/partners/[id].tsx');
  for (const key of ['partners.money.theyOweUs', 'partners.money.weOweThem', 'partners.custody.ours', 'partners.custody.theirs']) {
    assert.ok(detail.includes(key), `missing ${key}`);
  }
});

console.log(`partners: ${passed} passed`);
