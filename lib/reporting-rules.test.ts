/**
 * One set of dated rules on every screen (docs/53): the sale on its day, a cancellation and a
 * return as negative adjustments on theirs, an expense reversal on its own row, and the sales
 * count's definition stated wherever a count is shown. The figures are the server's; these pins
 * hold what each screen shows of them, and that it adds nothing up itself.
 *
 *   node lib/reporting-rules.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0;
const it = (name: string, fn: () => void) => {
  try { fn(); passed++; } catch (e) { console.error(`✗ ${name}`); throw e; }
};
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const code = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const en = read('./i18n/en.ts');

it('Home: returns come off on their own line, and the expenses say what was reversed', () => {
  const home = code(read('../app/(tabs)/index.tsx'));
  assert.match(home, /figures\.returns\.count > 0 \?/);
  assert.match(home, /t\('home\.sales\.returns', \{ count: String\(figures\.returns\.count\) \}\)/);
  assert.match(home, /<MoneyValue value=\{-figures\.returns\.value\} size="small" \/>/);
  assert.match(home, /figures\.expensesReversed > 0 \? t\('home\.sales\.expenses\.reversed'/);
  assert.match(read('./home.ts'), /expensesReversed: number;/);
});

it('Money: items sold as defined, the period\'s cancellations and returns apart, net sales, the rule stated', () => {
  const money = code(read('../app/(tabs)/money-hub.tsx'));
  assert.match(money, /count=\{data\.period\.unitsSold\}/);
  assert.match(money, /t\('moneyOverview\.cancelled', \{ count: String\(data\.period\.cancellations\.count\) \}\)/);
  assert.match(money, /t\('moneyOverview\.returns', \{ count: String\(data\.period\.returns\.count\) \}\)/);
  assert.match(money, /<MoneyValue value=\{data\.period\.netSalesValue\} size="small" \/>/);
  assert.match(money, /t\('moneyOverview\.countRule'\)/);
  // A day row shows the day's net, and what came off it — both the server's.
  assert.match(money, /value=\{d\.net\}/);
  assert.match(money, /formatMoney\(-d\.adjusted\)/);
  assert.ok(!/\.reduce\(/.test(money), 'nothing is summed on the phone');
});

it('Money: today\'s expenses list each reversal as its own negative row, named as the Daily closing names it', () => {
  const money = code(read('../app/(tabs)/money-hub.tsx'));
  assert.match(money, /data\.expensesToday\.reversed > 0 \?/);
  assert.match(money, /\$\{e\.expenseId \?\? e\.id\}/);
  const line = code(read('../components/money/ExpenseLine.tsx'));
  assert.match(line, /e\.kind === 'reversal' \? t\('dailyReport\.expenses\.reversal', \{ category: e\.description \}\)/);
});

it('Analytics: returned units and returns counted apart, and the rule stated', () => {
  const a = code(read('../app/analytics.tsx'));
  assert.match(a, /t\('analytics\.soldReturned'/);
  assert.match(a, /t\('analytics\.salesReturns'/);
  assert.match(a, /t\('analytics\.rule'\)/);
});

it('Goals and the Daily closing state what their count and figures mean', () => {
  assert.match(code(read('../app/goals/index.tsx')), /t\(`goals\.rule\.\$\{goal\.metric\}`\)/);
  for (const m of ['gross_profit', 'revenue', 'sales_count', 'units_sold']) assert.ok(en.includes(`'goals.rule.${m}':`), m);
  const closing = code(read('../app/closing/index.tsx'));
  assert.match(closing, /count: String\(report\.sales\.salesCount \?\? report\.sales\.count\)/);
  assert.match(closing, /t\('dailyReport\.countRule'\)/);
});

it('the definition reads the same everywhere: invoices less whole sales cancelled, a return apart', () => {
  for (const k of ['dailyReport.countRule', 'analytics.rule', 'goals.rule.sales_count']) {
    const line = en.split(/\r?\n/).find((l) => l.includes(`'${k}':`)) ?? '';
    assert.match(line, /less whole sales cancelled/, k);
  }
  const units = en.split(/\r?\n/).find((l) => l.includes(`'moneyOverview.countRule':`)) ?? '';
  assert.match(units, /less those on cancelled sales\. A return is counted apart/);
});

it('Home: net sales under the gross value and its adjustments; the chart and Collected say what they count (docs/54)', () => {
  const home = code(read('../app/(tabs)/index.tsx'));
  assert.match(home, /const adjusted = figures \? figures\.cancellations\.count > 0 \|\| figures\.returns\.count > 0 : false;/);
  assert.match(home, /<MoneyValue value=\{figures\.netSalesValue\} size="large" \/>/);
  assert.match(home, /t\('home\.chart\.basis'\)/);
  assert.match(home, /caption=\{t\('home\.sales\.collected\.scope'\)\}/);
  assert.ok(!/\.reduce\(/.test(home), 'nothing is summed on the phone');
  const line = (k: string) => en.split(/\r?\n/).find((l) => l.includes(`'${k}':`)) ?? '';
  assert.match(line('home.chart.basis'), /before cancellations and returns/);
  assert.match(line('home.sales.collected.scope'), /older debts included/);
});

it('the revenue goal is named for what it measures, and the units goal takes returns off (docs/54)', () => {
  for (const lang of ['en', 'fr', 'ar']) {
    const file = read(`./i18n/${lang}.ts`);
    const line = (k: string) => file.split(/\r?\n/).find((l) => l.includes(`'${k}':`)) ?? '';
    assert.ok(!/Money taken|Argent encaissé|المبالغ المحصّلة/.test(line('goals.metric.revenue')), lang);
    assert.equal(line('goals.metric.revenue'), line('moneyOverview.netSales').replace('moneyOverview.netSales', 'goals.metric.revenue'), lang);
  }
  const units = en.split(/\r?\n/).find((l) => l.includes(`'goals.rule.units_sold':`)) ?? '';
  assert.match(units, /less items on cancelled sales and items returned, each taken off on the day it was approved/);
});

it('Analytics says what "not moving" counts, and a product row keeps its width for the name', () => {
  const a = code(read('../app/analytics.tsx'));
  assert.match(a, /t\('analytics\.deadStock\.rule', \{ days: num\(data\.deadStockDays\) \}\)/);
  assert.match(a, /subtitle=\{p\.trackingType \? t\(`catalog\.tracking\.\$\{p\.trackingType\}` as never\) : undefined\}/);
  assert.ok(!/<Chip/.test(a));
  const rule = en.split(/\r?\n/).find((l) => l.includes(`'analytics.deadStock.rule':`)) ?? '';
  assert.match(rule, /A cancelled sale does not count: its goods never left\. A returned item still counts as sold\./);
});

it('Money: the today-only figures name the business day, in every language; the tab label has its room (docs/55)', () => {
  const money = code(read('../app/(tabs)/money-hub.tsx'));
  assert.match(money, /t\('moneyOverview\.accounts\.hint', \{ date: formatDate\(data\.today\) \}\)/);
  assert.match(money, /t\('moneyOverview\.dailyExpenses\.hint', \{ date: formatDate\(data\.today\) \}\)/);
  for (const lang of ['en', 'fr', 'ar']) {
    const file = read(`./i18n/${lang}.ts`);
    for (const k of ['moneyOverview.accounts.hint', 'moneyOverview.dailyExpenses.hint']) {
      const line = file.split(/\r?\n/).find((l) => l.includes(`'${k}':`)) ?? '';
      assert.ok(line.includes('({date})'), `${lang} ${k}`);
    }
  }
  const tabs = code(read('../app/(tabs)/_layout.tsx'));
  assert.match(tabs, /const compactLabels = useWindowDimensions\(\)\.width < 360;/);
  assert.match(tabs, /tabBarLabelStyle: \{ \.\.\.\(compactLabels \? typeScale\.tabLabelCompact : typeScale\.tabLabel\), flexShrink: 0 \}/);
  assert.match(read('./design/tokens.ts'), /tabLabelCompact: \{ fontSize: 10, lineHeight: 14, fontWeight: '600' \}/);
});

console.log(`reporting-rules: ${passed} passed`);
