/**
 * Every authenticated child screen has a back arrow, and it always leads somewhere sensible.
 *
 *   node lib/navigation/back.test.ts
 *
 * A route file added under `app/` must be named in BACK_PARENTS (a child: the
 * header and its arrow, and where the arrow goes with no history) or NO_BACK (a
 * tab or an entry flow, with the reason). An unclassified route fails here.
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BACK_PARENTS, NO_BACK, TABS, backTarget, routeOfFile, routeOfName } from './back.ts';

const APP = fileURLToPath(new URL('../../app/', import.meta.url));
const read = (p: string) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const code = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : full.endsWith('.tsx') ? [full] : [];
  });
}
/** Every screen file, as `app/...`: layouts are navigators, not screens; the signed-out group keeps its own stack. */
const screens = files(APP)
  .map((f) => 'app/' + f.slice(APP.length).replace(/\\/g, '/'))
  .filter((f) => !f.endsWith('/_layout.tsx') && !f.startsWith('app/(auth)/') && f !== 'app/index.tsx');
const routes = [...new Set(screens.map(routeOfFile))];

it('every route is classified: a child with a parent, or a tab or entry flow with a reason', () => {
  for (const route of routes) {
    assert.ok(route in BACK_PARENTS || route in NO_BACK, `${route} has neither a back parent nor a reason for none`);
    assert.ok(!(route in BACK_PARENTS && route in NO_BACK), `${route} is in both lists`);
  }
  for (const reason of Object.values(NO_BACK)) assert.ok(reason.length > 10);
});

it('every listed route exists — the map cannot rot', () => {
  for (const route of [...Object.keys(BACK_PARENTS), ...Object.keys(NO_BACK)]) {
    assert.ok(routes.includes(route), `${route} is listed but no screen has it`);
  }
});

it('every parent is a real screen or tab, and following parents always ends at a tab', () => {
  const tabs = new Set<string>(Object.values(TABS));
  for (const [route, parent] of Object.entries(BACK_PARENTS)) {
    assert.ok(routes.includes(parent) || tabs.has(parent) || parent === '/login', `${route} → ${parent} is not a screen`);
    let at = parent;
    for (let hops = 0; hops < 6 && !tabs.has(at) && at !== '/platform' && at !== '/login'; hops += 1) at = BACK_PARENTS[at];
    assert.ok(tabs.has(at) || at === '/platform' || at === '/login', `${route} never reaches a tab (stopped at ${at})`);
  }
  assert.deepEqual(Object.values(TABS), ['/', '/partners', '/money-hub', '/inventory', '/more']);
});

it('with no history the arrow goes to the parent, with the route’s own parameters, never to a broken address', () => {
  assert.equal(backTarget('/closing/sources'), '/closing');
  assert.equal(backTarget('/expenses/new'), '/expenses');
  assert.equal(backTarget('/money'), '/money-hub');
  assert.equal(backTarget('/quick-sell'), '/');
  assert.equal(backTarget('/transfers/[id]', { id: 'T-1' }), '/transfers');
  // A payment returns to its own sale; without the sale's id, to the sales list.
  assert.equal(backTarget('/sales/pay/[id]', { id: '0190-ab' }), '/sales/0190-ab');
  assert.equal(backTarget('/sales/pay/[id]', {}), '/sales');
  assert.equal(backTarget('/sales/pay/[id]', { id: 'a b/c' }), '/sales/a%20b%2Fc');
  // A route nobody listed goes home rather than nowhere.
  assert.equal(backTarget('/nowhere'), '/');
});

it('file and navigator names become the same pattern', () => {
  assert.equal(routeOfFile('app/sales/pay/[id].tsx'), '/sales/pay/[id]');
  assert.equal(routeOfFile('app/closing/index.tsx'), '/closing');
  assert.equal(routeOfFile('app/(tabs)/money-hub.tsx'), '/money-hub');
  assert.equal(routeOfName('closing/index'), '/closing');
  assert.equal(routeOfName('(tabs)'), '/');
  assert.equal(routeOfName('unit/[identifier]'), '/unit/[identifier]');
});

it('the root stack gives every child route its header and the shared arrow, and keeps the swipe', () => {
  const layout = code(read('app/_layout.tsx'));
  assert.match(layout, /headerShown: routeOfName\(route\.name\) in BACK_PARENTS,/);
  assert.match(layout, /headerLeft: headerBackFor\(routeOfName\(route\.name\), route\.params as Record<string, unknown> \| undefined, navigation\),/);
  assert.match(layout, /gestureEnabled: true,/);
  const platform = code(read('app/platform/_layout.tsx'));
  assert.match(platform, /headerLeft: headerBackFor\(routeOfName\(`platform\/\$\{route\.name\}`\)/);
});

/**
 * Flows whose own arrow steps back inside them or asks before leaving, approved
 * one by one: the same arrow (left, right in Arabic; Back), and when they do
 * leave, the shared rule — never a bare router.back() that does nothing without history.
 */
const OWN_ARROW: Readonly<Record<string, string>> = {
  'app/expenses/new.tsx': 'Its review step returns to the form; on the form the shared arrow applies.',
  'app/quick-sell.tsx': 'Back from a way in or the review returns to the three choices, then leaves.',
  'app/quick-receive.tsx': 'The counter shortcut; leaves by the shared rule.',
  'app/receive.tsx': 'Asks before a staged delivery is left behind; the file button keeps the top right in Arabic.',
};

it('no screen hides the header, turns the swipe off or replaces the arrow, except the approved flows', () => {
  for (const file of screens) {
    const src = code(read(file));
    const route = routeOfFile(file);
    assert.ok(!/gestureEnabled:\s*false/.test(src), `${file} turns the swipe-back off`);
    if (file in OWN_ARROW) {
      assert.match(src, /icon=\{isRTL\(\) \? ArrowRight : ArrowLeft\}/, `${file}: the arrow points the reading way back`);
      assert.match(src, /accessibilityLabel=\{t\('action\.back'\)\}/, `${file}: the arrow is announced as Back`);
      if (file === 'app/expenses/new.tsx') {
        assert.match(src, /\.\.\.\(reviewing\s*\?\s*\{\s*headerBackVisible: false,\s*headerLeft:/, 'only the review step replaces the arrow');
      } else {
        assert.match(src, /const leave = useLeave\('\/[a-z-]+'\);/, `${file}: leaving follows the shared rule`);
        assert.ok(!/router\.back\(\)/.test(src), `${file}: a bare router.back() does nothing without history`);
      }
      continue;
    }
    assert.ok(!/headerBackVisible:\s*false/.test(src), `${file} hides the back button`);
    assert.ok(!/headerLeft:/.test(src), `${file} replaces the shared back arrow`);
    if (route in BACK_PARENTS) assert.ok(!/headerShown:\s*false/.test(src), `${file} hides its header, and the arrow with it`);
  }
});

it('no screen leaves with a bare router.back(): Back, Cancel, Discard and after-save all follow the shared rule', () => {
  for (const file of screens) {
    // A guarded step back with its own way out is allowed (Catalogue → New product returns to the delivery it left).
    const src = code(read(file)).replace(/if \(router\.canGoBack\(\)\) router\.back\(\);\s*else router\.replace\(/g, '');
    assert.ok(!/router\.back\(\)/.test(src), `${file}: a bare router.back() does nothing when the screen was opened with no history`);
  }
  assert.match(code(read('app/sales/pay/[id].tsx')), /const leave = useLeave\('\/sales\/pay\/\[id\]', \{ id: sale\.id \}\);/);
  assert.match(code(read('app/receive/file.tsx')), /action=\{\{ label: t\('action\.back'\), onPress: leave \}\}/);
});

it('the arrow: the same step as the swipe with history, the parent without; left in LTR, right in Arabic; 48 points', () => {
  const back = code(read('components/navigation/HeaderBack.tsx'));
  assert.match(back, /if \(navigation\.canGoBack\(\)\) navigation\.goBack\(\);\s*else router\.replace\(backTarget\(route, params\) as Href\);/);
  assert.match(back, /<IconButton icon=\{isRTL\(\) \? ArrowRight : ArrowLeft\} accessibilityLabel=\{t\('action\.back'\)\}/);
  // The native arrow stays wherever the phone draws one; ours only fills the gap, and a tab or entry flow gets none.
  assert.match(back, /route in NO_BACK \|\| \(Platform\.OS !== 'web' && canGoBack\) \? null : <HeaderBack/);
  const button = code(read('components/ui/IconButton.tsx'));
  assert.match(button, /size = touch\.min,/);
  assert.match(read('lib/design/tokens.ts'), /min: 48/);
});

it('Sell, outside the stack header, carries the same arrow — and so does its closed-store panel', () => {
  const sell = code(read('app/(tabs)/sell.tsx'));
  assert.match(sell, /const stack = navigation\.getParent\(\) \?\? navigation;/);
  assert.match(sell, /<HeaderBack route="\/sell" navigation=\{stack\} \/>/);
  assert.match(sell, /<DayGate backRoute="\/sell">/);
  const gate = code(read('components/day/DayGate.tsx'));
  assert.match(gate, /\{backRoute \? <HeaderBack route=\{backRoute\} navigation=\{navigation\.getParent\(\) \?\? navigation\} \/> : null\}/);
  assert.ok(!/t\('action\.back'\)/.test(gate), 'the panel no longer adds a second Back beside the header’s');
});
