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
/** Opening and reopening, with the money the shop opens with — one flow for every place that opens (docs/63). */
const flow = code(read('components/day/useOpeningFlow.tsx'));

it('Open the boutique asks first: the choice sheet for the Owner, the notice for anybody else, from the server’s dates', () => {
  assert.match(flow, /if \(choices\.includes\('start_new'\)\) \{\s*setStage\('day'\);/);
  assert.match(flow, /intent === 'open' && openingPrompt\(day\.openChoices, day\.localNowDate, day\.businessDate\) === 'notice'/);
  // The notice is in the amounts sheet (one modal, docs/63); only an older server, with no sheet after, asks in a dialog.
  assert.match(flow, /notice=\{notice\}/);
  assert.match(flow, /if \(notice && !day\.openingMoney\) \{\s*const ok = await dialog\.confirm\(\{[\s\S]*?t\('openChoice\.notice\.title'/);
  // The notice names the business day, the calendar date, the time and the day only the Owner may start.
  assert.match(flow, /t\('openChoice\.notice\.body', \{[\s\S]*?time: isolateLtr\(day\.localNow\)[\s\S]*?calendarDate: formatDate\(day\.localNowDate\)[\s\S]*?date: formatDate\(day\.businessDate\)[\s\S]*?next: formatDate\(day\.nextDate\)/);
  assert.ok(!flow.includes('new Date()') && !closing.includes('new Date()'), 'the opening never consults the phone’s clock for the choice');
  // The Daily closing opens and reopens through that one flow.
  assert.match(closing, /const opening = useOpeningFlow\(\{ intent: 'open', day, date, onOpened: onRefresh \}\);/);
  assert.match(closing, /const reopening = useOpeningFlow\(\{ intent: 'reopen', day, date, onOpened: onRefresh \}\);/);
});

it('the opening is recorded only after the choice and the amounts, with the mode chosen; a plain opening sends no mode at all', () => {
  assert.match(flow, /onConfirm=\{\(chosen\) => void amounts\(chosen, true\)\}/);
  assert.match(flow, /onConfirm=\{\(money\) => void send\(mode, money\)\}/);
  assert.match(flow, /await openDay\.mutateAsync\(\{ \.\.\.\(chosen \? \{ mode: chosen \} : \{\}\), \.\.\.\(openingMoney \? \{ openingMoney \} : \{\}\) \}\)/);
  assert.match(hooks, /api\.post<OpenClosing>\('\/closings\/open', \{ \.\.\.\(date \? \{ date \} : \{\}\), \.\.\.\(mode \? \{ mode \} : \{\}\), \.\.\.\(openingMoney \? \{ openingMoney \} : \{\}\) \}\)/);
});

it('one sheet serves the opening and the reopen, the safe default selected, remounted each fresh time it is asked for', () => {
  assert.match(flow, /<DayChoiceSheet\s+key=\{`day-\$\{nonce\}`\}\s+intent=\{intent\}/);
  assert.match(flow, /const choices = day \? \(intent === 'open' \? \(day\.openChoices \?\? \['continue'\]\) : day\.reopenChoices\) : \[\];/);
  // Fresh unless the last attempt failed: then the chosen day and the amounts are still there (the user's brief, 29 Sep).
  assert.match(flow, /if \(!failed\) setNonce\(\(n\) => n \+ 1\);/);
  assert.match(sheet, /useState<ReopenMode>\(options\[0\]\.mode\)/);
  assert.match(sheet, /const prefix = intent === 'open' \? 'openChoice' : 'reopen';/);
  assert.match(sheet, /accessibilityRole="radiogroup"/);
});

it('Home’s header is the shared header on its tint, with the store’s date and, before 06:00, the business day sales still count for — beside the greeting’s own line, never in its place', () => {
  assert.match(header, /from 'react-native-svg'/);
  assert.match(header, /<TabHeader[\s\S]*?subtitle=\{subtitle\}[\s\S]*?bell/);
  assert.match(header, /\{note \? \([\s\S]*?\{note\}/);
  assert.match(home, /subtitle=\{shortcutsReady \? t\('home\.welcome\.ready'\) : t\('home\.welcome\.preparing'\)\}/);
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

it('the three money cards are text first: a word, the amount, its scope — no icon, a tint only, side by side where they fit and stacked for large text', () => {
  const card = home.slice(home.indexOf('function FigureCard('), home.indexOf('function changeColour('));
  assert.ok(!/icon|Icon/.test(card), 'no icon on a figure card');
  assert.match(card, /<MoneyValue value=\{value\} tone=\{tone\} showCurrency=\{false\} \/>/);
  assert.match(card, /PixelRatio\.getFontScale\(\) >= 1\.2/);
  assert.match(home, /figureRow: \{ flexDirection: 'row', flexWrap: 'wrap'/);
  assert.match(home, /figureFull: \{ flexBasis: '100%' \}/);
  assert.match(home, /tone=\{figures\.stillOwed > 0 \? 'negative' : 'muted'\}/);
  assert.equal((home.match(/<FigureCard\b/g) ?? []).length, 3);
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
