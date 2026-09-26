/**
 * The pre-06:00 opening choice and the simple Home (docs/56), pinned in the
 * source: what the screens must keep doing whatever their styling becomes.
 *
 *   node lib/home-screen.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
/** Source without its comments, so a pin never matches prose. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/[^\n]*/g, '$1');

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

const closing = code(read('app/closing/index.tsx'));
const sheet = code(read('components/closing/DayChoiceSheet.tsx'));
const home = code(read('app/(tabs)/index.tsx'));
const header = code(read('components/home/HomeHeader.tsx'));
const hooks = code(read('lib/closing.ts'));

it('Open the boutique asks first: the choice sheet for the Owner, the notice for anybody else, from the server’s dates', () => {
  assert.match(closing, /openingPrompt\(day\.openChoices, day\.localNowDate, day\.businessDate\)/);
  assert.match(closing, /prompt === 'choice'[\s\S]*?setOpenSheet\(true\)/);
  assert.match(closing, /prompt === 'notice'[\s\S]*?dialog\.confirm\(\{[\s\S]*?t\('openChoice\.notice\.title'/);
  // The notice names the business day, the calendar date, the time and the day only the Owner may start.
  assert.match(closing, /t\('openChoice\.notice\.body', \{[\s\S]*?time: isolateLtr\(day\.localNow\)[\s\S]*?calendarDate: formatDate\(day\.localNowDate\)[\s\S]*?date: formatDate\(day\.businessDate\)[\s\S]*?next: formatDate\(day\.nextDate\)/);
  assert.ok(!closing.includes('new Date()'), 'the closing screen never consults the phone’s clock for the choice');
});

it('the opening is recorded only after the choice, with the mode chosen; a plain opening sends no mode at all', () => {
  assert.match(closing, /onConfirm=\{\(mode\) => void recordOpening\(mode\)\}/);
  assert.match(closing, /if \(!ok\) return;\s*\}\s*await recordOpening\(\);/);
  assert.match(hooks, /mutationFn: \(mode\?: ReopenMode\) => api\.post<OpenClosing>\('\/closings\/open', \{ \.\.\.\(date \? \{ date \} : \{\}\), \.\.\.\(mode \? \{ mode \} : \{\}\) \}\)/);
});

it('one sheet serves the opening and the reopen, the safe default selected, remounted each time it is asked for', () => {
  assert.match(closing, /<DayChoiceSheet\s+intent="reopen"/);
  assert.match(closing, /<DayChoiceSheet\s+key=\{openSheetNonce\}\s+intent="open"/);
  assert.match(closing, /choices=\{day\.openChoices \?\? \['continue'\]\}/);
  assert.match(sheet, /useState<ReopenMode>\(options\[0\]\.mode\)/);
  assert.match(sheet, /const prefix = intent === 'open' \? 'openChoice' : 'reopen';/);
  assert.match(sheet, /accessibilityRole="radiogroup"/);
});

it('Home’s header is the shared header on its tint, with the store’s date and, before 06:00, the business day sales still count for', () => {
  assert.match(header, /from 'react-native-svg'/);
  assert.match(header, /<TabHeader[\s\S]*?subtitle=\{note\}[\s\S]*?bell/);
  assert.match(home, /const storeDate = data \? formatDateFns\(calendarDate\(data\.businessDay\.localDate\)/);
  assert.match(home, /const previousDayRunning = data \? data\.businessDay\.businessDate !== data\.businessDay\.localDate : false;/);
  assert.match(home, /t\('home\.day\.previous', \{ date: formatDate\(data\.businessDay\.businessDate\) \}\)/);
  const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
  assert.ok(!('expo-linear-gradient' in pkg.dependencies), 'no dependency was added for one tint');
  assert.ok('react-native-svg' in pkg.dependencies);
});

it('the comparison is printed only when the server supplied one; nothing is computed on the phone', () => {
  assert.match(home, /const comparison = figures\?\.comparison\?\.salesValue;/);
  assert.match(home, /const change = comparison\?\.available \? changeText\(comparison\.changePercent\) : null;/);
  assert.match(home, /\{change && comparison\?\.available \? \(/);
  assert.ok(!/changePercent\s*=|\/\s*previous|\* 100/.test(home), 'no percentage is computed on the phone');
  const contract = code(read('lib/contract.ts'));
  assert.match(contract, /comparison\?\.salesValue\?\.available === true[\s\S]*?\['previous', 'changePercent'\]/);
});

it('the closing entry opens the Daily closing and names the business day when it is not the calendar date', () => {
  assert.match(home, /data\.closing\.businessDate === data\.businessDay\.localDate\s*\? t\('home\.closing\.today'/);
  assert.match(home, /t\('home\.closing\.day', \{ date: formatDate\(data\.closing\.businessDate\)/);
  assert.match(home, /data\.closing\.previousDay\.needsReview \? <Chip tone="warning" label=\{t\('home\.closing\.previous'\)\}/);
});

it('the three money lines are text first: a word, its scope, the amount — no icon', () => {
  const lines = home.slice(home.indexOf('function FigureLine('), home.indexOf('function changeColour('));
  assert.ok(!/icon|Icon/.test(lines), 'no icon on a figure line');
  assert.match(lines, /<MoneyValue value=\{value\} size="large" tone=\{tone\} \/>/);
  assert.match(home, /tone=\{figures\.stillOwed > 0 \? 'negative' : 'muted'\}/);
});

it('every catalogue carries the opening-choice and Home keys', () => {
  const keys = [
    'openChoice.title',
    'openChoice.question',
    'openChoice.continue.title',
    'openChoice.continue.body',
    'openChoice.startNew.title',
    'openChoice.startNew.body',
    'openChoice.confirm',
    'openChoice.note',
    'openChoice.notice.title',
    'openChoice.notice.body',
    'openChoice.started',
    'home.closing.day',
    'home.day.previous',
    'home.compare.previous',
    'home.compare.yesterday',
  ];
  for (const lang of ['en', 'fr', 'ar']) {
    const catalogue = read(`lib/i18n/${lang}.ts`);
    for (const key of keys) assert.ok(catalogue.includes(`'${key}':`), `${lang} lacks ${key}`);
  }
});

console.log(`home-screen: ${passed} passed`);
