/**
 * The six-screen layout: Home, Partners, Money, Results, Stock and More.
 *
 *   node lib/layout.test.ts
 *
 * Pure rules are called; screen structure is read from source, the same way the
 * registry and stock suites do, so this runs under bare node with no bundler.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { periodDays, periodRange } from './period.ts';
import { homeFigures } from './home-figures.ts';
import { resultLines } from './results.ts';
import { movementTotals } from './money-movement-rules.ts';
import { MONEY_QUERY_PREFIXES, invalidateMoney } from './money-invalidation.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  try { fn(); passed++; } catch (e) { console.error(`✗ ${name}`); throw e; }
};
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const code = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const PROFIT = {
  grossSales: 1000, returnsRevenue: 100, netRevenue: 900, cogs: 600, returnsCogs: 60,
  netCogs: 540, grossProfit: 360, expenses: 60, netOperatingProfit: 300,
};

// ── the shared period ───────────────────────────────────────────────────────

const NOW = new Date('2026-09-15T13:00:00Z');

it('Today is one day, 7 days includes today, This month is month-to-date', () => {
  assert.deepEqual(periodRange('today', NOW), { from: '2026-09-15', to: '2026-09-15' });
  assert.deepEqual(periodRange('week', NOW), { from: '2026-09-09', to: '2026-09-15' });
  assert.deepEqual(periodRange('month', NOW), { from: '2026-09-01', to: '2026-09-15' });
  assert.equal(periodDays('week', NOW), 7);
  assert.equal(periodDays('month', NOW), 15);
});

it('7 days crosses a month boundary correctly', () => {
  assert.deepEqual(periodRange('week', new Date('2026-03-02T01:00:00Z')), { from: '2026-02-24', to: '2026-03-02' });
});

it('Money and Results read the same period store and the same selector', () => {
  const money = code(read('../app/(tabs)/money-hub.tsx'));
  const results = code(read('../app/money.tsx'));
  for (const src of [money, results]) {
    assert.match(src, /usePeriod\(\(s\) => s\.key\)/);
    assert.match(src, /periodRange\(key\)/);
    assert.match(src, /<PeriodSelector \/>/);
  }
});

// ── Home ────────────────────────────────────────────────────────────────────

it('Home: Sell and Receive side by side, with the several-items link under them', () => {
  const home = code(read('../app/(tabs)/index.tsx'));
  const row = home.slice(home.indexOf('styles.actionRow'), home.indexOf("t('home.shortcut.fullSale')"));
  assert.match(row, /t\('home\.shortcut\.sell'\)/);
  assert.match(row, /t\('home\.shortcut\.receive'\)/);
  assert.match(home, /router\.push\('\/quick-sell' as Href\)/);
  assert.match(home, /router\.push\('\/quick-receive' as Href\)/);
  assert.match(home, /router\.push\('\/\(tabs\)\/sell'\)/);
  assert.match(read('../app/(tabs)/index.tsx'), /actionRow: \{ flexDirection: 'row'/);
});

it('Home shows exactly the four approved figures, and no stock or menu section', () => {
  const home = code(read('../app/(tabs)/index.tsx'));
  const labels = [...home.matchAll(/t\('home\.figure\.(\w+)'\)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(labels)].sort(), ['collected', 'expenses', 'profit', 'sales']);
  for (const gone of ['home.stock.', 'home.more.title', 'lowStock', 'supplier', 'inventoryValue']) {
    assert.ok(!home.includes(gone), `Home must not contain ${gone}`);
  }
  assert.match(home, /<TabHeader[\s\S]*?bell/);
});

it('without cost.view, profit and sales-after-returns are absent — never zero', () => {
  const restricted = homeFigures({ expenseDetail: { total: 50, fixed: 0, salaries: 0, count: 1 }, collected: { total: 20, cash: 20, account: 0, count: 1 } });
  assert.equal(restricted.profit, null);
  assert.equal(restricted.sales, null);
  assert.equal(restricted.expenses, 50);
  assert.equal(restricted.collected, 20);
  const home = code(read('../app/(tabs)/index.tsx'));
  assert.match(home, /figures\.profit \? \(/, 'the profit card renders only when the server sent profit');
  assert.match(home, /figures\.sales !== null \? \(/, 'sales renders only when the server sent it');
});

it('all-zero month is one sentence, not four explanations', () => {
  const zero = homeFigures({
    profit: { ...PROFIT, grossSales: 0, returnsRevenue: 0, netRevenue: 0, netCogs: 0, grossProfit: 0, expenses: 0, netOperatingProfit: 0, cogs: 0, returnsCogs: 0 },
    expenseDetail: { total: 0, fixed: 0, salaries: 0, count: 0 },
    collected: { total: 0, cash: 0, account: 0, count: 0 },
  });
  assert.equal(zero.allZero, true);
  assert.equal(homeFigures({ profit: PROFIT, expenseDetail: { total: 60, fixed: 0, salaries: 0, count: 1 } }).allZero, false);
  const home = code(read('../app/(tabs)/index.tsx'));
  assert.ok(!home.includes('home.month.noComparison'), 'no repeated "nothing to compare" line');
});

// ── Results ─────────────────────────────────────────────────────────────────

it('Results lines are the server fields, in reading order', () => {
  assert.deepEqual(resultLines(PROFIT), {
    sales: 1000, approvedReturns: 100, salesAfterReturns: 900, costOfSoldItems: 540,
    profitBeforeExpenses: 360, expenses: 60, finalProfit: 300,
  });
});

it('Results keeps the breakdown and the returns timing closed, and hides profit without cost', () => {
  const src = code(read('../app/money.tsx'));
  assert.match(src, /<Disclosure title=\{t\('results\.breakdown'\)\}>/);
  assert.match(src, /<Disclosure title=\{t\('results\.returnsTiming'\)\}>/);
  assert.match(src, /s\?\.profit \? resultLines\(s\.profit\) : null/);
  assert.match(src, /t\('results\.hidden\.title'\)/);
  for (const k of ['approval', 'due', 'reported', 'confirmed']) {
    assert.ok(read('./i18n/en.ts').includes(`'results.returnsTiming.${k}':`));
  }
});

// ── Money ───────────────────────────────────────────────────────────────────

it('Money totals add channels up and say they are recorded, not a bank balance', () => {
  const t = movementTotals([
    { channel: 'cash', accountId: null, label: 'CASH', isUnattributed: false, moneyIn: 1000.1, moneyOut: 200.05, net: 800.05 },
    { channel: 'account', accountId: 'a', label: 'Bankily', isUnattributed: false, moneyIn: 500, moneyOut: 0, net: 500 },
  ]);
  assert.deepEqual(t, { moneyIn: 1500.1, moneyOut: 200.05, net: 1300.05 });
  const src = code(read('../app/(tabs)/money-hub.tsx'));
  assert.match(src, /t\('moneyTab\.recorded'\)/);
  assert.match(src, /<Disclosure title=\{t\('moneyTab\.channels'\)\}>/);
  assert.match(src, /visibleChildren\(hub, granted\)/, 'actions come from the registry');
  assert.match(src, /enabled: canViewFigures/, 'figures need report.view');
});

it('every money-moving mutation refreshes Home, Money and Results', () => {
  const seen: unknown[] = [];
  invalidateMoney({ invalidateQueries: (f: unknown) => { seen.push(f); return Promise.resolve(); } } as never);
  assert.deepEqual(seen, MONEY_QUERY_PREFIXES.map((k) => ({ queryKey: [k] })));
  for (const file of ['../app/quick-sell.tsx', '../app/(tabs)/sell.tsx', '../app/quick-receive.tsx', '../app/receive.tsx', './expenses.ts', './returns.ts', './closing.ts', './corrections.ts']) {
    assert.match(code(read(file)), /invalidateMoney\(qc\)/, `${file} must invalidate money queries`);
  }
});

// ── Partners, Stock, More ───────────────────────────────────────────────────

it('Partners: header Add hidden when the settled list is empty, own code copyable, rows expand', () => {
  const src = code(read('../app/(tabs)/partners.tsx'));
  assert.match(src, /canManage && !\(settledEmpty && canView\)/);
  assert.match(src, /const settledEmpty = connections\.isSuccess && empty/);
  assert.match(src, /Clipboard\.setStringAsync\(code\)/);
  assert.match(src, /useConnectionSummary\(open \? c\.id : undefined\)/, 'shared detail fetched only when opened');
  assert.match(src, /t\('partners\.money\.theyOweUs'\)[\s\S]*t\('partners\.money\.weOweThem'\)/);
  // Order: received, connected, sent, past.
  const order = ['partners.section.received', 'partners.section.connected', 'partners.section.sent', 'partners.section.past'].map((k) => src.indexOf(k));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

it('Stock header counts and values on the server, cost only when sent', () => {
  const src = code(read('../app/(tabs)/inventory.tsx'));
  assert.match(src, /'\/analytics\/inventory-value'/);
  assert.match(src, /totals\.inventoryValue !== undefined \?/);
  assert.match(src, /enabled: Boolean\(branchId\) && canViewReports/);
});

it('every primary tab uses the shared header', () => {
  for (const tab of ['index', 'partners', 'money-hub', 'inventory', 'more']) {
    assert.match(read(`../app/(tabs)/${tab}.tsx`), /<TabHeader\b/, `${tab} must use TabHeader`);
  }
});

console.log(`layout: ${passed} passed`);
