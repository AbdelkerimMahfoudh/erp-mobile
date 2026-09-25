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

console.log(`reporting-rules: ${passed} passed`);
