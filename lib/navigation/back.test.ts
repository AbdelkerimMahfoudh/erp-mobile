/**
 * Every authenticated child screen has a back arrow, and it always leads somewhere sensible.
 *
 *   node lib/navigation/back.test.ts
 *
 * Every route file under `app/` is exactly one of (docs/61 §10): a parent tab
 * (TAB_ROUTES); a child with the header, its arrow and where it goes with no
 * history (BACK_PARENTS); an invisible redirect or the bootstrap splash
 * (REDIRECTS, BOOTSTRAP_FILE); or, outside the signed-in app, an authentication
 * root (AUTH_ROOTS). An unclassified or doubly classified route fails here.
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUTH_ROOTS,
  BACK_PARENTS,
  BOOTSTRAP_FILE,
  NO_BACK,
  REDIRECTS,
  TABS,
  TAB_ROUTES,
  backTarget,
  routeOfFile,
  routeOfName,
} from './back.ts';

const APP = fileURLToPath(new URL('../../app/', import.meta.url));
const read = (p: string) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const code = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : full.endsWith('.tsx') ? [full] : [];
  });
}
/** Every route file, as `app/...` — layouts are navigators, not routes. */
const routeFiles = files(APP)
  .map((f) => 'app/' + f.slice(APP.length).replace(/\\/g, '/'))
  .filter((f) => !f.endsWith('/_layout.tsx'));
/** The screens of the app itself: not the signed-out group, not the splash. */
const screens = routeFiles.filter((f) => !f.startsWith('app/(auth)/') && f !== BOOTSTRAP_FILE);
const routes = [...new Set(routeFiles.filter((f) => f !== BOOTSTRAP_FILE).map(routeOfFile))];

type RouteClass = 'tab' | 'child' | 'redirect' | 'bootstrap' | 'auth';
function classesOf(file: string): RouteClass[] {
  if (file === BOOTSTRAP_FILE) return ['bootstrap'];
  const route = routeOfFile(file);
  const out: RouteClass[] = [];
  if (route in TAB_ROUTES) out.push('tab');
  if (route in BACK_PARENTS) out.push('child');
  if (route in REDIRECTS) out.push('redirect');
  if (route in AUTH_ROOTS) out.push('auth');
  return out;
}

it('every route file is exactly one of: parent tab, child with the arrow, invisible redirect or bootstrap, authentication root', () => {
  for (const file of routeFiles) {
    const classes = classesOf(file);
    assert.equal(classes.length, 1, `${file} is ${classes.length ? classes.join(' and ') : 'unclassified'}`);
  }
  for (const reason of [...Object.values(TAB_ROUTES), ...Object.values(REDIRECTS), ...Object.values(AUTH_ROOTS)]) assert.ok(reason.length > 10);
  // The routes without an arrow are exactly the tabs, the redirects and the authentication roots — nothing miscellaneous.
  assert.deepEqual(Object.keys(NO_BACK).sort(), [...Object.keys(TAB_ROUTES), ...Object.keys(REDIRECTS), ...Object.keys(AUTH_ROOTS)].sort());
  // Seven parent tabs since the money services counter (D157) — a branch draws five at most, by its activity and
  // the role (`tabBarFor`, pinned in registry.test.ts).
  assert.equal(Object.keys(TAB_ROUTES).length, 7);
});

it('the routes without an arrow: /stores is an invisible redirect; branch choice and the access refusal are authentication roots', () => {
  assert.ok('/stores' in REDIRECTS);
  assert.ok('/select-branch' in AUTH_ROOTS && '/access-closed' in AUTH_ROOTS);
  // A redirect renders nothing but the redirect, to a route that exists; it needs no parameter and loads nothing.
  const stores = code(read('app/stores/index.tsx'));
  assert.match(stores, /return <Redirect href="\/\(tabs\)\/partners" \/>;/);
  assert.ok(!/useQuery|useLocalSearchParams|<Text|<Button|<Screen/.test(stores), 'no page, no data, no parameter');
  assert.ok(routeFiles.includes('app/(tabs)/partners.tsx'), 'the redirect resolves to a real tab');
  // The splash is a spinner only: nothing to press, nothing to read.
  const splash = code(read(BOOTSTRAP_FILE));
  assert.match(splash, /<ActivityIndicator/);
  assert.ok(!/<Text|<Button|Pressable|onPress/.test(splash));
  // Each authentication root has its own way on, and Sign out.
  const branch = code(read('app/select-branch.tsx'));
  assert.match(branch, /title=\{t\('action\.signOut'\)\}[\s\S]*onPress=\{signOut\}/);
  assert.match(branch, /<ErrorState error=\{query\.error\} onRetry=/);
  assert.match(branch, /onPress=\{\(\) => setBranch\(branch\)\}/);
  const closed = code(read('app/access-closed.tsx'));
  assert.match(closed, /title=\{t\('access\.recheck'\)\}/);
  assert.match(closed, /title=\{t\('action\.signOut'\)\}/);
});

it('every listed route exists — the map cannot rot', () => {
  for (const route of [...Object.keys(BACK_PARENTS), ...Object.keys(NO_BACK)]) {
    assert.ok(routes.includes(route), `${route} is listed but no screen has it`);
  }
});

it('every parent is a real screen or tab, and following parents always ends at a tab', () => {
  const tabs = new Set<string>(Object.values(TABS));
  for (const [route, parent] of Object.entries(BACK_PARENTS)) {
    assert.ok(routes.includes(parent) || tabs.has(parent), `${route} → ${parent} is not a screen`);
    let at = parent;
    for (let hops = 0; hops < 6 && !tabs.has(at); hops += 1) at = BACK_PARENTS[at];
    assert.ok(tabs.has(at), `${route} never reaches a tab (stopped at ${at})`);
  }
  assert.deepEqual(Object.values(TABS), ['/', '/partners', '/agent-transactions', '/money-hub', '/inventory', '/agent-reports', '/more']);
});

it('with no history the arrow goes to the parent, with the route’s own parameters, never to a broken address', () => {
  assert.equal(backTarget('/closing/sources'), '/closing');
  assert.equal(backTarget('/expenses/new'), '/expenses');
  assert.equal(backTarget('/money'), '/money-hub');
  assert.equal(backTarget('/quick-sell'), '/');
  // The counter flow is Home's action, as Quick sell is; one exchange returns to the exchanges (D157).
  assert.equal(backTarget('/agent/new'), '/');
  assert.equal(backTarget('/agent/[id]', { id: 'X-1' }), '/agent-transactions');
  assert.equal(backTarget('/agent/reports'), '/money-hub');
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
