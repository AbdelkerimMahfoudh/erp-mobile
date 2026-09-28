/**
 * Words that name a place or an action are never cut (docs/61 §13): a tab's name
 * fits its tab, the counter actions stack before a label is cut, the store's name
 * wraps — and the measuring that decides it stays invisible.
 *
 *   node lib/label-fit.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { FIT_MARGIN, TAB_ITEM_PADDING, labelScale, sideBySideBasis, tabLabelRoom } from './label-fit.ts';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('a tab’s room is its share of the bar less the navigator’s padding', () => {
  assert.equal(tabLabelRoom(320, 5), 54); // the narrowest phone: 64-point tabs
  assert.ok(Math.abs(tabLabelRoom(393, 5) - 68.6) < 1e-9);
  assert.equal(tabLabelRoom(320, 4), 70); // a role without Partners or Money
  assert.equal(tabLabelRoom(0, 5), 0);
  assert.equal(tabLabelRoom(320, 0), 0);
});

test('the padding is the navigator’s own', () => {
  const item = new URL('../node_modules/expo-router/build/react-navigation/bottom-tabs/views/BottomTabItem.js', import.meta.url);
  if (!existsSync(item)) return; // no installed dependencies: nothing to compare with
  const block = readFileSync(item, 'utf8').match(/tabVerticalUiKit: \{([^}]*)\}/);
  assert.ok(block, 'the navigator’s vertical tab style');
  assert.match(block[1], new RegExp(`padding: ${TAB_ITEM_PADDING},`));
});

test('a name that fits is drawn as designed; one not measured yet too', () => {
  assert.equal(labelScale(54, 50.5), 1); // "Partenaires" at the compact 10 points
  assert.equal(labelScale(54, 54), 1);
  assert.equal(labelScale(54, 0), 1);
  assert.equal(labelScale(0, 66), 1);
});

test('a name too wide is drawn just small enough to fit, with room to spare for rounding', () => {
  // French "Partenaires", 320 points, 1.3× text: 66 wanted, 54 given.
  const s = labelScale(54, 66);
  assert.ok(s * 66 <= 54 * FIT_MARGIN + 1e-9, 'fits, with the margin');
  assert.ok(s * 66 >= 54 * FIT_MARGIN - 0.1, 'and no smaller than needed');
  assert.ok(s * 13 > 10, 'still above the compact 10 points it would have at ordinary text');
  // 393 points, 1.3×: 72 wanted, 68.6 given — barely smaller.
  assert.ok(labelScale(68.6, 72) > 0.9 && labelScale(68.6, 72) < 1);
  // Twice the text: shrinks further, never to nothing.
  const twice = labelScale(54, 101);
  assert.ok(twice * 101 <= 54 && twice > 0.5);
});

test('two actions side by side ask for their designed width, or what their widest label needs', () => {
  assert.equal(sideBySideBasis(160, [], 68), 160);
  assert.equal(sideBySideBasis(160, [0, 0], 68), 160, 'not measured yet: as designed');
  assert.equal(sideBySideBasis(160, [90, 50], 68), 160, '"Réceptionner" at ordinary text: the breakpoint holds');
  assert.equal(sideBySideBasis(160, [117.2, 60], 68), 186, 'large text: the label decides, rounded up');
  // 393 points: 361 of row, 8 of gap — two of 186 do not fit, so the row stacks them.
  assert.ok(2 * sideBySideBasis(160, [117.2, 60], 68) + 8 > 361);
  assert.ok(2 * sideBySideBasis(160, [90, 50], 68) + 8 <= 361, 'while at ordinary text they stay side by side');
});

test('the tab bar fits each name in the navigator’s own font, and keeps iOS’s rule of not scaling them', () => {
  const tabs = code(read('../app/(tabs)/_layout.tsx'));
  assert.match(tabs, /const TAB_NAMES_SCALE = Platform\.OS === 'ios' \? false : undefined;/);
  assert.match(tabs, /const nameRoom = tabLabelRoom\(width - 2 \* Math\.max\(insets\.left, insets\.right\), shown\.length\);/);
  assert.match(tabs, /labelScale\(nameRoom, nameWidths\[nameKey\(names\[route\]\)\] \?\? 0\)/);
  assert.match(tabs, /tabBarLabelStyle: tabLabelStyle\(route\.name\),/);
  assert.match(tabs, /<TextMeasure\s+texts=\{shown\.map\(\(route\) => names\[route\]\)\}\s+style=\{\[DefaultTheme\.fonts\.medium, labelType\]\}\s+allowFontScaling=\{TAB_NAMES_SCALE\}/);
  // The names measured are the names drawn: each shown tab's title, in the same order as the bar.
  for (const [route, key] of [['index', 'tab.home'], ['partners', 'tab.partners'], ['money-hub', 'tab.money'], ['inventory', 'tab.inventory'], ['more', 'tab.more']]) {
    assert.ok(tabs.includes(`${route.includes('-') ? `'${route}'` : route}: t('${key}')`), `${route} measured as ${key}`);
    assert.match(tabs, new RegExp(`name="${route}"[\\s\\S]*?title: t\\('${key.replace('.', '\\.')}'\\)`), `${route} drawn as ${key}`);
  }
  assert.match(tabs, /const shown = \['index', \.\.\.\(showPartners \? \['partners'\] : \[\]\), \.\.\.\(canSeeMoney \? \['money-hub'\] : \[\]\), 'inventory', 'more'\];/);
  assert.match(tabs, /href: showPartners \? undefined : null/);
  assert.match(tabs, /href: canSeeMoney \? undefined : null/);
});

test('the store’s name in every tab’s header wraps instead of being cut', () => {
  const header = code(read('../components/ui/TabHeader.tsx'));
  const context = header.slice(header.indexOf('{context ? ('), header.indexOf('{context}'));
  assert.ok(context.length > 0 && !/numberOfLines/.test(context), 'the context line has no line limit');
  const title = header.slice(header.indexOf('<Text variant="title"'), header.indexOf('{title}'));
  assert.ok(!/numberOfLines/.test(title), 'nor the title');
});

test('Home’s counter actions stack before a label is cut', () => {
  const home = code(read('../app/(tabs)/index.tsx'));
  assert.match(home, /const actionBasis = sideBySideBasis\(ACTION_BASIS, actionTitles\.map\(\(title\) => actionWidths\[title\] \?\? 0\), buttonChrome\('lg', true\)\);/);
  const row = home.slice(home.indexOf('styles.actionRow'), home.indexOf('<OpenStoreNow'));
  assert.equal((row.match(/size="lg"/g) ?? []).length, 2, 'both are large buttons, as measured');
  assert.equal((row.match(/style=\{\[styles\.action, \{ flexBasis: actionBasis \}\]\}/g) ?? []).length, 2);
  assert.match(row, /<TextMeasure\s+texts=\{actionTitles\}\s+style=\{typeScale\[buttonLabelVariant\('lg'\)\]\}/);
  assert.match(home, /const actionTitles = \[\.\.\.\(canReceive \? \[t\('home\.shortcut\.receive'\)\] : \[\]\), \.\.\.\(canSell \? \[t\('home\.shortcut\.sell'\)\] : \[\]\)\];/);
  assert.match(home, /action: \{ flexGrow: 1 \},/);
});

test('the measuring is never seen, read aloud or touched', () => {
  const src = read('../components/ui/TextMeasure.tsx');
  for (const prop of ['pointerEvents="none"', 'aria-hidden', 'accessibilityElementsHidden', 'importantForAccessibility="no-hide-descendants"']) {
    assert.ok(src.includes(prop), prop);
  }
  assert.match(src, /opacity: 0,/);
  assert.match(src, /visibility: 'hidden'/);
  assert.match(src, /width: 0,\s+height: 0,\s+overflow: 'hidden',/);
});
