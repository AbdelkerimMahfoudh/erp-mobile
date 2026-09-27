/**
 * Today on arrival at a tab — proved without a screen.
 *
 *   node lib/tab-arrival.test.ts
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { leftTab } from './tab-arrival.ts';

const read = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const TABS = { index: 0, routes: [{ key: 'index-a1', name: 'index' }, { key: 'money-hub-b2', name: 'money-hub' }] };

it('the tab bar still showing this tab is not leaving it', () => {
  assert.equal(leftTab(TABS, 'index-a1'), false);
  assert.equal(leftTab({ ...TABS, index: 1 }, 'money-hub-b2'), false);
});

it('the tab bar showing another tab is leaving this one', () => {
  assert.equal(leftTab({ ...TABS, index: 1 }, 'index-a1'), true);
  assert.equal(leftTab(TABS, 'money-hub-b2'), true);
});

it('an index past the routes shows no tab, so it is not this one', () => {
  assert.equal(leftTab({ ...TABS, index: 5 }, 'index-a1'), true);
  assert.equal(leftTab({ index: 0, routes: [] }, 'index-a1'), true);
});

it('the hook resets before the first paint and whenever the tab bar shows another tab, never on focus', () => {
  const src = code(read('lib/use-tab-arrival.ts'));
  assert.match(src, /useLayoutEffect\(\(\) => latest\.current\(\), \[\]\);/);
  assert.match(src, /navigation\.addListener\('state', \(e\) => \{\s*if \(leftTab\(e\.data\.state, route\.key\)\) latest\.current\(\);/);
  // The way back from a pushed screen is not an arrival, and a mounted tab never sees its own route change.
  for (const gone of ['useFocusEffect', 'useSegments', 'usePathname']) {
    assert.ok(!src.includes(gone), `use-tab-arrival must not use ${gone}`);
  }
});

it('Back to Money pops down to the tabs already open: a navigate pushed a second set, and Money lost its period', () => {
  const expenses = code(read('app/expenses/index.tsx'));
  assert.match(expenses, /onPress=\{\(\) => router\.dismissTo\('\/\(tabs\)\/money-hub' as Href\)\}/);
  assert.ok(!/router\.(navigate|push|replace)\('\/\(tabs\)/.test(expenses), 'no route into the tabs from above them');
});

console.log('tab-arrival: all assertions passed');
