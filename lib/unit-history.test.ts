/**
 * The Unit history, as words — proved without a screen.
 *
 *   node lib/unit-history.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { format } from 'date-fns';
import { dateLocaleFor } from './date-locale.ts';
import {
  describeUnitEvent,
  groupHistory,
  HISTORY_KEYS,
  roleKey,
  statusKey,
  type UnitHistoryEvent,
} from './unit-history.ts';

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
const catalogue = (lang: string) => {
  const text = source(`lib/i18n/${lang}.ts`);
  const map = new Map<string, string>();
  for (const m of text.matchAll(/^\s*'([^']+)':\s*'((?:[^'\\]|\\.)*)'/gm)) map.set(m[1], m[2]);
  return map;
};
const en = catalogue('en');
const fr = catalogue('fr');
const ar = catalogue('ar');

const change = (from: string | null, to: string | null, extra: Partial<UnitHistoryEvent> = {}): UnitHistoryEvent => ({
  at: '2026-08-07T14:34:15Z',
  entity: 'Unit',
  action: 'status_change',
  fromStatus: from,
  toStatus: to,
  ...extra,
});

/* ── meaning ────────────────────────────────────────────────────────────── */

it('create means received into stock', () => {
  assert.equal(describeUnitEvent({ at: 'x', entity: 'Unit', action: 'create' }).titleKey, 'history.event.received');
});

it('each recorded transition maps to its business meaning', () => {
  const cases: [string | null, string, Partial<UnitHistoryEvent>, string][] = [
    ['in_stock', 'sold', {}, 'history.event.sold'],
    ['in_stock', 'reserved', { toBranch: { name: 'Warehouse' } }, 'history.event.reservedTo'],
    ['in_stock', 'reserved', {}, 'history.event.reserved'],
    ['reserved', 'in_transit', { toBranch: { name: 'Warehouse' } }, 'history.event.sentTo'],
    ['reserved', 'in_transit', {}, 'history.event.sent'],
    ['in_transit', 'in_stock', { toBranch: { name: 'Warehouse' } }, 'history.event.arrivedAt'],
    ['reserved', 'in_stock', { context: 'transfer_cancelled' }, 'history.event.transferCancelled'],
    ['reserved', 'in_stock', { context: 'transfer_rejected' }, 'history.event.transferRejected'],
    ['sold', 'returned', { context: 'return_intake' }, 'history.event.returnIntake'],
    ['returned', 'faulty', { context: 'return_approved' }, 'history.event.returnApproved'],
    ['returned', 'sold', { context: 'return_rejected' }, 'history.event.returnRejected'],
    ['in_stock', 'faulty', {}, 'history.event.faulty'],
    ['faulty', 'in_stock', {}, 'history.event.backInStock'],
  ];
  for (const [from, to, extra, key] of cases) {
    assert.equal(describeUnitEvent(change(from, to, extra)).titleKey, key, `${from} → ${to}`);
  }
});

it('shows the destination branch as a parameter, not baked into a string', () => {
  assert.deepEqual(describeUnitEvent(change('reserved', 'in_transit', { toBranch: { name: 'Warehouse' } })).params, { branch: 'Warehouse' });
});

it('a transition between known statuses without a special meaning shows both statuses', () => {
  const d = describeUnitEvent(change('sold', 'transferred_out'));
  assert.equal(d.titleKey, 'history.event.changed');
  assert.deepEqual(d.params, { from: 'status.unit.sold', to: 'status.unit.transferred_out' });
});

it('reads old and new status from legacy before/after when the facts are absent', () => {
  const legacy: UnitHistoryEvent = { at: 'x', entity: 'Unit', action: 'status_change', before: { status: 'in_stock' }, after: { status: 'sold' } };
  assert.equal(describeUnitEvent(legacy).titleKey, 'history.event.sold');
});

it('never invents a transition: no status recorded means "Inventory updated"', () => {
  assert.equal(describeUnitEvent(change(null, null)).titleKey, 'history.event.updated');
  assert.equal(describeUnitEvent({ at: 'x', entity: 'Unit', action: 'price_override' }).titleKey, 'history.event.updated');
  assert.equal(describeUnitEvent({ at: 'x', entity: 'Return', action: 'create' }).titleKey, 'history.event.updated');
  assert.equal(describeUnitEvent(change('mystery', 'unheard_of')).titleKey, 'history.event.updated');
});

it('does not make every event look successful', () => {
  const tones = new Set(
    [change('in_stock', 'sold'), change('in_stock', 'faulty'), change('reserved', 'in_stock', { context: 'transfer_cancelled' }), change('in_stock', 'reserved')].map(
      (e) => describeUnitEvent(e).tone,
    ),
  );
  assert.ok(tones.size >= 3, [...tones].join(','));
  assert.equal(describeUnitEvent(change('in_stock', 'faulty')).tone, 'danger');
  assert.notEqual(describeUnitEvent(change('in_stock', 'sold')).tone, 'success');
});

it('maps roles and statuses to keys, and unknown values to null rather than a code', () => {
  assert.equal(roleKey('store_manager'), 'team.role.store_manager');
  assert.equal(roleKey('something'), null);
  assert.equal(statusKey('in_transit'), 'status.unit.in_transit');
  assert.equal(statusKey('in-transit'), null);
});

/* ── grouping ───────────────────────────────────────────────────────────── */

it('is newest first, grouped by day, with today and yesterday named', () => {
  const now = new Date(2026, 7, 10, 12, 0);
  const days = groupHistory(
    [
      { at: new Date(2026, 7, 1, 9).toISOString(), entity: 'Unit', action: 'create' },
      change('in_stock', 'sold', { at: new Date(2026, 7, 10, 9).toISOString() }),
      change('in_stock', 'reserved', { at: new Date(2026, 7, 9, 9).toISOString() }),
    ],
    now,
  );
  assert.deepEqual(days.map((d) => d.day), ['today', 'yesterday', '2026-08-01']);
});

it('folds consecutive identical entries into a counted run and drops none', () => {
  const at = (m: number) => new Date(2026, 7, 7, 14, m).toISOString();
  const pair = (m: number) => [
    change('in_transit', 'in_stock', { at: at(m + 1), toBranch: { name: 'Warehouse' }, actor: { name: 'Demo Owner', role: 'owner' } }),
    change('in_stock', 'in_transit', { at: at(m), actor: { name: 'Demo Owner', role: 'owner' } }),
  ];
  const repeated = [
    change('in_stock', 'sold', { at: at(40) }),
    change('in_stock', 'in_transit', { at: at(30) }),
    change('in_stock', 'in_transit', { at: at(31) }),
    change('in_stock', 'in_transit', { at: at(32) }),
    ...pair(10),
  ];
  const days = groupHistory(repeated, new Date(2026, 8, 1));
  const runs = days.flatMap((d) => d.runs);
  assert.equal(runs.reduce((n, r) => n + r.entries.length, 0), repeated.length, 'every entry is kept');
  const folded = runs.find((r) => r.entries.length === 3);
  assert.ok(folded, 'three identical sends fold into one run');
  assert.equal(folded.described.titleKey, 'history.event.sent');
});

it('does not fold entries by different people', () => {
  const days = groupHistory(
    [
      change('in_stock', 'in_transit', { at: '2026-08-07T14:30:00Z', actor: { name: 'A', role: 'owner' } }),
      change('in_stock', 'in_transit', { at: '2026-08-07T14:31:00Z', actor: { name: 'B', role: 'owner' } }),
    ],
    new Date('2026-09-01T00:00:00Z'),
  );
  assert.equal(days.flatMap((d) => d.runs).length, 2);
});

/* ── languages ──────────────────────────────────────────────────────────── */

it('every history key exists in EN, FR and AR, and FR/AR are not copies of English', () => {
  for (const key of HISTORY_KEYS) {
    for (const [lang, cat] of [['en', en], ['fr', fr], ['ar', ar]] as const) {
      assert.ok(cat.has(key), `${lang} is missing ${key}`);
    }
    // Pure placeholder layouts are the same in every language by design.
    if (key !== 'history.byName' && key !== 'history.byRole') {
      assert.notEqual(fr.get(key), en.get(key), `fr ${key} is English`);
      assert.notEqual(ar.get(key), en.get(key), `ar ${key} is English`);
    }
  }
});

it('every unit status and role the timeline names is translated', () => {
  for (const s of ['in_stock', 'reserved', 'sold', 'returned', 'faulty', 'in_transit', 'transferred_out']) {
    for (const cat of [en, fr, ar]) assert.ok(cat.has(`status.unit.${s}`));
  }
  for (const r of ['owner', 'store_manager', 'store_employee']) {
    for (const cat of [en, fr, ar]) assert.ok(cat.has(`team.role.${r}`));
  }
});

it('placeholders survive translation', () => {
  for (const key of ['history.event.sentTo', 'history.event.reservedTo', 'history.event.arrivedAt', 'history.event.changed', 'history.repeat', 'history.byRole']) {
    const want = [...(en.get(key) ?? '').matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const cat of [fr, ar]) assert.deepEqual([...(cat.get(key) ?? '').matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), want, key);
  }
});

it('dates follow the selected language', () => {
  const d = new Date(2026, 6, 30, 18, 7);
  assert.equal(format(d, 'd MMM yyyy', { locale: dateLocaleFor('en') }), '30 Jul 2026');
  assert.match(format(d, 'd MMMM yyyy', { locale: dateLocaleFor('fr') }), /juillet/);
  assert.match(format(d, 'd MMMM yyyy', { locale: dateLocaleFor('ar') }), /يوليو/);
});

/* ── the screen keeps its promises ──────────────────────────────────────── */

const SCREEN = withoutComments(source('app/unit/[identifier].tsx'));
const TIMELINE = withoutComments(source('components/inventory/ActivityTimeline.tsx'));

it('never renders a raw event code, action or status', () => {
  assert.ok(!/event\.action\b|\.action\}|entry\.action|lead\.action/.test(SCREEN + TIMELINE), 'no action rendered');
  assert.ok(!/status\.replace|action\.replace/.test(SCREEN + TIMELINE));
  assert.match(TIMELINE, /describeUnitEvent|groupHistory/);
});

it('no internal route name can appear as a back label', () => {
  assert.match(withoutComments(source('app/_layout.tsx')), /headerBackButtonDisplayMode: 'minimal'/);
});

it('keeps cost behind the server\'s permission gate', () => {
  assert.match(SCREEN, /data\.cost !== undefined \?/);
});

it('shows IMEI 1, IMEI 2 and serial as distinct, left-to-right identifiers', () => {
  assert.match(SCREEN, /t\('unit\.imei1'\)/);
  assert.match(SCREEN, /t\('unit\.imei2'\)/);
  assert.match(SCREEN, /t\('unit\.serial'\)/);
  assert.match(SCREEN, /<Identifier/);
});

it('a long history does not bury the screen, and every entry stays one tap away', () => {
  assert.match(TIMELINE, /const INITIAL_ROWS = \d+;/);
  assert.match(TIMELINE, /t\('history\.more', \{ count: hiddenEvents \}\)/);
  assert.match(TIMELINE, /setShowAll\(/);
});

it('keeps dates and amounts in reading order inside Arabic sentences', () => {
  assert.match(TIMELINE, /isolateLtr\(/);
});

console.log(`unit history: ${passed} passed`);
