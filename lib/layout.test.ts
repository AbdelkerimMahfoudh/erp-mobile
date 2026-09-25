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
  grossSales: 1000, returnsRevenue: 100, cancelledRevenue: 0, netRevenue: 900, cogs: 600, returnsCogs: 60,
  cancelledCogs: 0, netCogs: 540, grossProfit: 360, expenses: 60, netOperatingProfit: 300,
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
    // 0076: the range ends on the branch's business date, asked of the server.
    assert.match(src, /usePeriodRange\(key\)/);
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

it('Home shows exactly the figures of the business-date contract, and no stock or menu section', () => {
  const home = code(read('../app/(tabs)/index.tsx'));
  const labels = [...home.matchAll(/t\('home\.sales\.(\w+)'\)/g)].map((m) => m[1]);
  // Net sales joins the four when a cancellation or return falls in the period (docs/54).
  assert.deepEqual([...new Set(labels)].sort(), ['collected', 'expenses', 'net', 'owed', 'value']);
  assert.match(home, /\{adjusted \? \(/);
  // The scope of "still owed" is said, not implied.
  assert.match(home, /t\('home\.sales\.owed\.scope'\)/);
  for (const gone of ['home.stock.', 'home.more.title', 'lowStock', 'supplier', 'inventoryValue', 'home.figure.', 'monthToDate', 'usePeriodSummary']) {
    assert.ok(!home.includes(gone), `Home must not contain ${gone}`);
  }
  assert.match(home, /<TabHeader[\s\S]*?bell/);
  // The three cards the reference names, each with its way onwards.
  assert.match(home, /t\('home\.top\.title'\)/);
  assert.match(home, /router\.push\('\/partners\/ranking' as Href\)/);
  assert.match(home, /t\('home\.arrivals\.title'\)/);
  assert.match(home, /category: 'phone', status: 'all', sort: 'received'/);
  assert.match(home, /t\('home\.closing\.review'\)/);
  assert.match(home, /router\.push\('\/closing' as Href\)/);
});

it('Home is one server read per period, and the bars are the server’s', () => {
  const home = code(read('../app/(tabs)/index.tsx'));
  const lib = code(read('../lib/home.ts'));
  assert.match(home, /useHome\(period/);
  assert.match(lib, /api\.get<HomeResponse>\(`\/home\?period=\$\{period\}`\)/);
  assert.match(home, /<SalesBars bars=\{data\.series\.bars\} unit=\{data\.series\.unit\}/);
  // Nothing is summed, subtracted or windowed on the phone.
  assert.ok(!/\.reduce\(\(?[a-z], ?[a-z]\)? => [a-z] \+ [a-z]\.value/.test(home), 'no client-side sum of the bars');
  assert.ok(!home.includes('toISOString().slice(0, 10)'), 'no client-side day key');
});

it('without report.view the figures are absent — never zero — and the arrivals carry no full identifier', () => {
  const home = code(read('../app/(tabs)/index.tsx'));
  assert.match(home, /const figures = data\?\.figures \?\? null;/);
  assert.match(home, /figures && data\?\.series \? \(/, 'the figures and the bars render only when the server sent them');
  assert.match(home, /identifierLast4/);
  assert.ok(!home.includes('imeiPrimary') && !home.includes('serialNo'), 'Home never reads a full identifier');
  const homeLib = code(read('../lib/home.ts'));
  assert.match(homeLib, /figures: HomeFigures \| null;/);
});

// ── Results ─────────────────────────────────────────────────────────────────

it('Results lines are the server fields, in reading order', () => {
  assert.deepEqual(resultLines(PROFIT), {
    sales: 1000, approvedReturns: 100, cancelledSales: 0, netSales: 900, costOfSoldItems: 540,
    profitBeforeExpenses: 360, expenses: 60, finalProfit: 300,
  });
});

/**
 * A sale of 11 000 (cost 8 400) cancelled, beside a kept sale of 10 000 (cost 8 000) — the
 * server's profit block for each period (docs/51 §16). The breakdown must add up on screen:
 * sales − returns − cancelled = net sales, net sales − cost = profit before expenses.
 */
it('Results: a sale cancelled the same day, and on a later day, each adds up on screen', () => {
  const block = (grossSales: number, cogs: number, cancelledRevenue: number, cancelledCogs: number) => ({
    grossSales, returnsRevenue: 0, cancelledRevenue, netRevenue: grossSales - cancelledRevenue,
    cogs, returnsCogs: 0, cancelledCogs, netCogs: cogs - cancelledCogs,
    grossProfit: grossSales - cancelledRevenue - (cogs - cancelledCogs), expenses: 0,
    netOperatingProfit: grossSales - cancelledRevenue - (cogs - cancelledCogs),
  });
  const sameDay = resultLines(block(21_000, 16_400, 11_000, 8_400));
  const saleDay = resultLines(block(21_000, 16_400, 0, 0));
  const cancelDay = resultLines(block(0, 0, 11_000, 8_400));
  for (const l of [sameDay, saleDay, cancelDay]) {
    assert.equal(l.sales - l.approvedReturns - l.cancelledSales, l.netSales);
    assert.equal(l.netSales - l.costOfSoldItems, l.profitBeforeExpenses);
  }
  assert.deepEqual([sameDay.netSales, sameDay.profitBeforeExpenses], [10_000, 2_000]);
  assert.deepEqual([saleDay.netSales, saleDay.profitBeforeExpenses], [21_000, 4_600]);
  assert.deepEqual([cancelDay.cancelledSales, cancelDay.netSales, cancelDay.profitBeforeExpenses], [11_000, -11_000, -2_600]);
  assert.equal(saleDay.netSales + cancelDay.netSales, sameDay.netSales);

  const src = code(read('../app/money.tsx'));
  // A period holding only the cancellation is not "no sales or expenses".
  assert.match(src, /s\.profit\.grossSales === 0 && s\.profit\.returnsRevenue === 0 && s\.profit\.cancelledRevenue === 0 && s\.profit\.expenses === 0/);
  assert.match(src, /lines\.cancelledSales !== 0 \? <Line label=\{t\('results\.cancelled'\)\} value=\{-lines\.cancelledSales\} \/> : null/);
  assert.match(src, /<Line label=\{t\('results\.netSales'\)\} value=\{lines\.netSales\} strong \/>/);
});

it('Home shows a cancellation of the period on its own line, under the sales value it does not change', () => {
  const home = code(read('../app/(tabs)/index.tsx'));
  assert.match(home, /figures\.cancellations\.count > 0 \?/);
  assert.match(home, /t\('home\.sales\.cancelled', \{ count: String\(figures\.cancellations\.count\) \}\)/);
  assert.match(home, /<MoneyValue value=\{-figures\.cancellations\.value\} size="small" \/>/);
  assert.match(home, /<MoneyValue value=\{figures\.salesValue\} size="display"/);
  assert.match(read('./home.ts'), /cancellations: \{ count: number; value: number; phones: number \};/);
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
