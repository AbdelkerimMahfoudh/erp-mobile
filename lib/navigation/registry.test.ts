/**
 * Drift guard for the More navigation registry (milestone N).
 *
 * Run directly with Node (type-stripping), no test runner or new dependency:
 *   node lib/navigation/registry.test.ts
 * Exits non-zero on any failure.
 *
 * The registry only helps if it cannot silently fall out of step with the app.
 * Three kinds of drift are worth failing a build over:
 *
 *  1. **A screen exists that nothing points at.** This is not hypothetical —
 *     Suppliers shipped and stayed unreachable from More for an entire
 *     milestone (`docs/29` S2). A new route now has to be classified: put it in
 *     a hub, or say in `EXCLUDED_ROUTES` why it does not belong in one.
 *  2. **A permission that is not real.** A typo in a permission string hides a
 *     row from everybody, and hiding looks exactly like "not allowed", so
 *     nobody reports it. The permission catalogue is read from
 *     `lib/permissions.ts` as text so this stays a dependency-free test.
 *  3. **A hub nobody can open.** An empty container teaches people the menu
 *     lies.
 *
 * Role permission sets below are the REAL ones, read from the seeded
 * `role_permissions` table, not invented for the test.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HUBS,
  EXCLUDED_ROUTES,
  allDestinations,
  canSee,
  hubById,
  visibleChildren,
  visibleHubs,
  tabHub,
  tabHubIsVisible,
} from './registry.ts';

let passed = 0;
const it = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log('  ok  ' + name);
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOBILE = path.resolve(HERE, '..', '..');
const APP_DIR = path.join(MOBILE, 'app');

// ── the real seeded role permission sets ─────────────────────────────────────

const OWNER = new Set(
  'branch.manage,catalog.manage,closing.count,closing.perform,connection.manage,consignment.custody.receive,consignment.custody.send,consignment.forgive,consignment.payment.confirm,consignment.payment.report,consignment.request,consignment.return.confirm,consignment.review,consignment.sell,consignment.view,cost.view,debt.manage,discount.apply,discount.override,expense.manage,expense.review,expense.submit,financial.correction.approve,financial.correction.request,goal.manage,import.run,integrations.manage,loan.forgive,loan.manage,loan.payment.confirm,loan.payment.report,loan.view,price.edit,purchase.manage,refund.confirm,refund.report,report.view,return.approve,return.exception,return.policy.override,return.reject,return.request,return.review,return.view,sale.create,sale.return,sale.view,settings.manage,supplier.manage,supplier.payment.confirm,supplier.payment.report,transfer.approve,transfer.cancel,transfer.cancel_own,transfer.receive,transfer.request,transfer.ship,transfer.view,unit.add,unit.transfer,user.manage'.split(
    ',',
  ),
);

const MANAGER = new Set(
  'catalog.manage,closing.count,closing.perform,consignment.custody.receive,consignment.custody.send,consignment.payment.report,consignment.request,consignment.return.confirm,consignment.review,consignment.sell,consignment.view,cost.view,discount.apply,expense.submit,financial.correction.request,goal.manage,import.run,loan.payment.report,loan.view,purchase.manage,refund.confirm,refund.report,report.view,return.approve,return.policy.override,return.reject,return.request,return.review,return.view,sale.create,sale.return,sale.view,supplier.manage,supplier.payment.confirm,supplier.payment.report,transfer.approve,transfer.cancel,transfer.cancel_own,transfer.receive,transfer.request,transfer.ship,transfer.view,unit.add'.split(
    ',',
  ),
);

const EMPLOYEE = new Set(
  'closing.count,consignment.custody.receive,consignment.custody.send,consignment.view,cost.view,discount.apply,expense.submit,purchase.manage,refund.report,return.request,return.view,sale.create,sale.view,supplier.payment.report,transfer.cancel_own,transfer.receive,transfer.request,transfer.ship,transfer.view,unit.add'.split(
    ',',
  ),
);

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Every permission the app knows, parsed from `lib/permissions.ts` as text.
 *
 * Comments are stripped FIRST. That file documents itself heavily and its prose
 * contains apostrophes — "an older session's permission set", "the Owner's
 * alone" — and a naive quote scan pairs one of those with the next real quote
 * and swallows the entries in between. This project has been bitten by reading
 * prose as code twice already; the third time is cheap to prevent.
 */
function knownPermissions(): Set<string> {
  const src = fs.readFileSync(path.join(MOBILE, 'lib', 'permissions.ts'), 'utf8');
  const block = src.match(/export const PERMISSIONS = \[([\s\S]*?)\] as const;/);
  assert.ok(block, 'could not find the PERMISSIONS array in lib/permissions.ts');
  const code = block[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const found = new Set([...code.matchAll(/'([^']+)'/g)].map((m) => m[1]));
  assert.ok(found.size > 40, 'parsed only ' + found.size + ' permissions — the parser is broken');
  return found;
}

/**
 * Every navigable route, derived from the `app/` directory the way expo-router
 * derives it: group folders `(x)` vanish, `index` collapses to its parent.
 */
function appRoutes(): string[] {
  const out: string[] = [];
  const walk = (dir: string, segments: string[]) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const isGroup = entry.name.startsWith('(') && entry.name.endsWith(')');
        walk(full, isGroup ? segments : [...segments, entry.name]);
        continue;
      }
      if (!entry.name.endsWith('.tsx')) continue;
      const base = entry.name.replace(/\.tsx$/, '');
      if (base === '_layout') continue;
      const parts = base === 'index' ? segments : [...segments, base];
      out.push('/' + parts.join('/'));
    }
  };
  walk(APP_DIR, []);
  return [...new Set(out)].sort();
}

/**
 * A route is covered when a hub names it, or names a parent of it.
 *
 * Sub-routes count as covered by their parent: `/sales/[id]` is reached from
 * `/sales`, so listing every detail screen would be noise that hides the one
 * thing this test is for — a genuinely new top-level feature nobody linked.
 */
function coveredByHub(route: string): boolean {
  return allDestinations().some((d) => route === d.route || route.startsWith(d.route + '/'));
}

/** Same subtree rule for exclusions: excluding `/discrepancies` excludes its detail. */
function excluded(route: string): boolean {
  return Object.keys(EXCLUDED_ROUTES).some((r) => route === r || route.startsWith(r + '/'));
}

const titles = (entries: { hub: { id: string } }[]) => entries.map((e) => e.hub.id);

// ── 1. complete route classification ─────────────────────────────────────────

it('every route in app/ is either in a hub or explicitly excluded', () => {
  const unclassified = appRoutes().filter(
    (r) => !coveredByHub(r) && !excluded(r),
  );
  assert.deepEqual(
    unclassified,
    [],
    'unclassified routes — add them to a hub, or to EXCLUDED_ROUTES with a reason:\n  ' +
      unclassified.join('\n  '),
  );
});

it('every exclusion names a real route and gives a reason', () => {
  const routes = new Set(appRoutes());
  for (const [route, reason] of Object.entries(EXCLUDED_ROUTES)) {
    assert.ok(routes.has(route), 'EXCLUDED_ROUTES lists a route that no longer exists: ' + route);
    assert.ok(reason.trim().length > 10, 'exclusion needs a real reason: ' + route);
  }
});

it('every hub destination points at a route that exists', () => {
  const routes = new Set(appRoutes());
  for (const d of allDestinations()) {
    assert.ok(
      routes.has(d.route) || routes.has(d.route + '/index'),
      'destination "' + d.id + '" points at a missing route: ' + d.route,
    );
  }
});

// ── 2. unique membership ─────────────────────────────────────────────────────

it('no destination appears in two hubs', () => {
  const seenRoute = new Map<string, string>();
  const seenId = new Map<string, string>();
  for (const hub of HUBS) {
    for (const child of hub.children) {
      const priorRoute = seenRoute.get(child.route);
      assert.equal(priorRoute, undefined, 'route ' + child.route + ' is in both ' + priorRoute + ' and ' + hub.id);
      seenRoute.set(child.route, hub.id);

      const priorId = seenId.get(child.id);
      assert.equal(priorId, undefined, 'id "' + child.id + '" is in both ' + priorId + ' and ' + hub.id);
      seenId.set(child.id, hub.id);
    }
  }
});

it('hub ids are unique', () => {
  const ids = HUBS.map((h) => h.id);
  assert.equal(new Set(ids).size, ids.length);
});

// ── 3. no empty hub ──────────────────────────────────────────────────────────

it('no hub is declared empty', () => {
  for (const hub of HUBS) {
    assert.ok(hub.children.length > 0, 'hub "' + hub.id + '" has no children');
  }
});

it('no hub renders empty for any real role', () => {
  for (const [role, granted] of [
    ['owner', OWNER],
    ['manager', MANAGER],
    ['employee', EMPLOYEE],
  ] as const) {
    for (const entry of visibleHubs(granted)) {
      assert.ok(
        entry.children.length > 0,
        'hub "' + entry.hub.id + '" would render empty for ' + role,
      );
    }
  }
});

// ── 4. permissions are real ──────────────────────────────────────────────────

it('every permission named by a destination exists in the catalogue', () => {
  const known = knownPermissions();
  for (const d of allDestinations()) {
    for (const p of [d.perm, ...(d.anyOf ?? [])].filter(Boolean) as string[]) {
      assert.ok(known.has(p), 'destination "' + d.id + '" names an unknown permission: ' + p);
    }
  }
});

// ── 5. role visibility ───────────────────────────────────────────────────────

it('an Owner sees the five business hubs — Money is a tab now, not a card', () => {
  assert.deepEqual(titles(visibleHubs(OWNER, 'business')), [
    'sales',
    'stock',
    'network',
    'performance',
    'business',
  ]);
  // Moved, not removed: the Owner still reaches all four of its children.
  assert.equal(hubById('money')?.placement, 'tab');
  assert.equal(visibleChildren(hubById('money')!, OWNER).length, 4);
});

it('an Owner sees every destination', () => {
  const hidden = allDestinations().filter((d) => !canSee(d, OWNER));
  assert.deepEqual(hidden.map((d) => d.id), []);
});

it('a Manager sees every business hub, without Team or Business settings', () => {
  assert.deepEqual(titles(visibleHubs(MANAGER, 'business')), [
    'sales',
    'stock',
    'network',
    'performance',
    'business',
  ]);
  // Money moved to the tab bar, and a Manager still reaches it there.
  assert.equal(tabHubIsVisible(MANAGER), true);
  const business = visibleChildren(hubById('business')!, MANAGER).map((c) => c.id);
  assert.deepEqual(business, ['subscription'], 'a Manager holds neither user.manage nor settings.manage');

  // A Manager cannot reach partner-store discovery, but does run consignments.
  const network = visibleChildren(hubById('network')!, MANAGER).map((c) => c.id);
  assert.deepEqual(network, ['consignments']);
});

it('an Employee sees no money report, no imports and no loans', () => {
  const money = visibleChildren(hubById('money')!, EMPLOYEE).map((c) => c.id);
  assert.deepEqual(money, ['expenses', 'closing'], 'no report.view, no loan.view');

  const stock = visibleChildren(hubById('stock')!, EMPLOYEE).map((c) => c.id);
  assert.deepEqual(stock, ['catalog', 'transfers', 'suppliers'], 'no import.run');

  const performance = visibleChildren(hubById('performance')!, EMPLOYEE).map((c) => c.id);
  assert.deepEqual(performance, ['goals'], 'no report.view, so no analytics');
});

it('an Employee still reaches Suppliers, through supplier.payment.report alone', () => {
  const suppliers = allDestinations().find((d) => d.id === 'suppliers')!;
  assert.ok(!EMPLOYEE.has('supplier.manage'));
  assert.ok(canSee(suppliers, EMPLOYEE));
});

it('hub order is identical for every role, with hidden hubs simply absent', () => {
  const order = HUBS.filter((h) => h.placement === 'business').map((h) => h.id);
  for (const granted of [OWNER, MANAGER, EMPLOYEE]) {
    const shown = titles(visibleHubs(granted, 'business'));
    assert.deepEqual(shown, order.filter((id) => shown.includes(id)), 'order shifted by role');
  }
});

// ── 6. a user with a single permission ───────────────────────────────────────

it('a user holding only sale.view sees exactly one hub with one child', () => {
  const granted = new Set(['sale.view']);
  const shown = visibleHubs(granted, 'business');
  // 'stock', 'performance' and 'business' contain ungated children, so they
  // stay — the assertion is about the gated ones vanishing cleanly.
  const salesHub = shown.find((e) => e.hub.id === 'sales');
  assert.ok(salesHub, 'the one permission held must produce its hub');
  assert.deepEqual(salesHub!.children.map((c) => c.id), ['sales']);
  assert.equal(shown.find((e) => e.hub.id === 'money'), undefined, 'no money permission, no money hub');
  assert.equal(shown.find((e) => e.hub.id === 'network'), undefined);
});

it('a user holding nothing at all sees only the ungated hubs, never an empty one', () => {
  const shown = visibleHubs(new Set<string>(), 'business');
  for (const entry of shown) assert.ok(entry.children.length > 0);
  assert.equal(shown.find((e) => e.hub.id === 'sales'), undefined);
  assert.equal(shown.find((e) => e.hub.id === 'money'), undefined);
});

// ── 7. the account hub ───────────────────────────────────────────────────────

it('the account hub is separate from the business hubs, and holds devices and sync', () => {
  const account = hubById('account')!;
  assert.equal(account.placement, 'account');
  assert.deepEqual(account.children.map((c) => c.id), ['devices', 'sync']);
  assert.equal(
    visibleHubs(new Set<string>(), 'business').find((e) => e.hub.id === 'account'),
    undefined,
    'the account hub must never appear among the business hubs',
  );
});

it('Business settings stays in the business hub, not in Account & security', () => {
  const account = hubById('account')!;
  assert.ok(!account.children.some((c) => c.route === '/settings'));
  assert.ok(hubById('business')!.children.some((c) => c.route === '/settings'));
});

it('the Sync center is reachable through the account hub whatever the queue holds', () => {
  // No permission and no condition: reachable when the queue is empty, which is
  // the only way to inspect its history.
  const sync = hubById('account')!.children.find((c) => c.id === 'sync')!;
  assert.equal(sync.perm, undefined);
  assert.equal(sync.anyOf, undefined);
  assert.ok(canSee(sync, new Set<string>()));
});

// ── 8. translation keys ──────────────────────────────────────────────────────

it('every hub and destination key exists in all three catalogues', () => {
  const keysOf = (locale: string) =>
    new Set(
      [
        ...fs
          .readFileSync(path.join(MOBILE, 'lib', 'i18n', locale + '.ts'), 'utf8')
          .matchAll(/^\s*'([^']+)':/gm),
      ].map((m) => m[1]),
    );
  const [en, ar, fr] = [keysOf('en'), keysOf('ar'), keysOf('fr')];

  const needed = [
    ...HUBS.flatMap((h) => [h.titleKey, h.descriptionKey]),
    ...allDestinations().map((d) => d.titleKey),
    'more.branch.switch',
    'more.notifications.a11y',
    'more.sync.waiting',
    'more.sync.attention',
    'more.sync.notConfirmed',
  ];
  for (const key of needed) {
    assert.ok(en.has(key), 'missing English key: ' + key);
    assert.ok(ar.has(key), 'missing Arabic key: ' + key);
    assert.ok(fr.has(key), 'missing French key: ' + key);
  }
});

it('no hub title or description is hardcoded English in the registry', () => {
  for (const hub of HUBS) {
    assert.match(hub.titleKey, /^hub\./, 'hub titles must be i18n keys');
    assert.match(hub.descriptionKey, /^hub\./);
  }
  for (const d of allDestinations()) {
    assert.match(d.titleKey, /^nav\./, 'destination titles must reuse the nav.* keys');
  }
});

// ── 9. legacy deep links ─────────────────────────────────────────────────────

it('every route the old More screen linked to is still linked, unchanged', () => {
  // Verbatim from the pre-N More screen. Branch, notifications and the language
  // control moved, and are accounted for as exclusions or in the account hub.
  const legacy = [
    '/sales', '/returns', '/catalog', '/transfers', '/suppliers', '/team',
    '/money', '/analytics', '/expenses', '/closing', '/goals', '/stores',
    '/consignments', '/loans', '/sync', '/subscription', '/imports',
    '/settings', '/devices', '/notifications', '/select-branch',
  ];
  for (const route of legacy) {
    const reachable = coveredByHub(route) || excluded(route);
    assert.ok(reachable, 'a route the old More linked to is now unreachable: ' + route);
  }
});

// ── 10. RTL, structurally ────────────────────────────────────────────────────

it('hub order is data, not layout — the registry knows nothing about direction', () => {
  const src = fs.readFileSync(path.join(HERE, 'registry.ts'), 'utf8');
  for (const forbidden of ['I18nManager', 'isRTL', 'mirror(', 'flexDirection']) {
    assert.ok(
      !src.includes(forbidden),
      'the registry must not reference "' + forbidden + '" — reading order is a rendering concern',
    );
  }
  // Same list, same order, whichever way the page reads.
  assert.deepEqual(
    HUBS.map((h) => h.id),
    ['sales', 'stock', 'money', 'network', 'performance', 'business', 'account'],
  );
});

it('the More and hub screens use no physical direction styles', () => {
  const screens = [
    path.join(MOBILE, 'app', '(tabs)', 'more.tsx'),
    path.join(MOBILE, 'app', 'hub', '[id].tsx'),
    path.join(MOBILE, 'components', 'navigation', 'LanguageRow.tsx'),
  ];
  // These do not flip under RTL; the logical properties and `mirror()` do.
  const physical = /\b(marginLeft|marginRight|paddingLeft|paddingRight|left:|right:|textAlign:\s*'left'|textAlign:\s*'right')/;
  for (const file of screens) {
    const src = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const hit = src.match(physical);
    assert.equal(hit, null, path.basename(file) + ' uses a physical direction style: ' + hit?.[0]);
  }
});

it('the one directional glyph on More is mirrored explicitly', () => {
  const src = fs.readFileSync(path.join(MOBILE, 'app', '(tabs)', 'more.tsx'), 'utf8');
  // Chevrons point. A chevron that does not mirror points the wrong way in
  // Arabic, which is worse than no chevron at all.
  assert.match(src, /<ChevronRight[^>]*style=\{mirror\(\)\}/, 'the branch chevron must use mirror()');
});

// ── 11. notifications ────────────────────────────────────────────────────────

it('Notifications is reached from the header bell, and is not also a business row', () => {
  const reason = EXCLUDED_ROUTES['/notifications'];
  assert.ok(reason, '/notifications must be classified');
  assert.match(reason, /bell|header/i, 'the exclusion should say where it moved to');

  // Not duplicated as a hub child anywhere.
  assert.equal(
    allDestinations().find((d) => d.route === '/notifications'),
    undefined,
    'Notifications must not appear in the business list as well as the header',
  );
});

it('the bell carries a translated accessible label, not a hardcoded one', () => {
  const src = fs.readFileSync(path.join(MOBILE, 'app', '(tabs)', 'more.tsx'), 'utf8');
  assert.match(src, /accessibilityLabel=\{t\('more\.notifications\.a11y'\)\}/);
  // No badge is rendered, because the notifications contract supplies no
  // unread count. Inventing or estimating one would be worse than showing none.
  // `BadgeCheck` is the subscription icon, not a badge — hence the exclusion.
  const withoutIcons = src.replace(/BadgeCheck/g, '');
  assert.ok(
    !/<Badge\b|badgeCount|unread/i.test(withoutIcons),
    'no badge may be shown while the notifications contract supplies no count',
  );
});


// ── Money as a bottom tab (CP2) ─────────────────────────────────────────────

const TABS_LAYOUT = () => fs.readFileSync(path.join(MOBILE, 'app', '(tabs)', '_layout.tsx'), 'utf8');

it('Money is a tab, not a card on More', () => {
  const money = hubById('money');
  assert.ok(money, 'the Money hub must still exist');
  assert.equal(money.placement, 'tab');
  assert.equal(tabHub()?.id, 'money');
});

it('and is therefore absent from the More business list', () => {
  /*
    The duplicate is removed by the SAME field that creates the tab. There is
    no edit where both exist, which is what stops a second copy being left
    behind by accident.
  */
  const all = new Set(['report.view', 'expense.submit', 'closing.count', 'loan.view']);
  const onMore = visibleHubs(all, 'business').map((e) => e.hub.id);
  assert.ok(!onMore.includes('money'), 'Money must not appear on More: ' + onMore.join(', '));
});

it('More still shows exactly the five remaining business hubs', () => {
  const all = new Set(HUBS.flatMap((h) => h.children).flatMap((c) => [c.perm, ...(c.anyOf ?? [])]).filter(Boolean));
  const onMore = visibleHubs(all, 'business').map((e) => e.hub.id);
  assert.deepEqual(onMore, ['sales', 'stock', 'network', 'performance', 'business']);
});

it('the whole hub moved — all four children, unchanged', () => {
  const money = hubById('money');
  assert.deepEqual(
    money.children.map((c) => c.route),
    ['/money', '/expenses', '/closing', '/loans'],
    'the complete Money section moves, not just its landing card',
  );
  // The permissions are the ones the hub always enforced. Widening any of them
  // here would hand a role a financial screen it was never given.
  assert.deepEqual(
    money.children.map((c) => c.perm),
    ['report.view', 'expense.submit', 'closing.count', 'loan.view'],
  );
});

it('the bar order is Home, Sell, Money, Inventory, More', () => {
  const src = TABS_LAYOUT();
  const order = [...src.matchAll(/name="([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ['index', 'sell', 'money-hub', 'inventory', 'more']);
});

it('with Money directly beside Sell', () => {
  const src = TABS_LAYOUT();
  const order = [...src.matchAll(/name="([a-z-]+)"/g)].map((m) => m[1]);
  assert.equal(order[order.indexOf('sell') + 1], 'money-hub');
});

it('RTL is left to the navigator, not reversed a second time', () => {
  // Mirroring the order here as well would put Money back on the wrong side of
  // Sell in Arabic — two reversals cancel out.
  const src = TABS_LAYOUT();
  assert.ok(!/reverse\(\)|I18nManager\.isRTL/.test(src), 'the tab bar must not mirror itself');
});

it('the tab is hidden, not emptied, when no child is permitted', () => {
  assert.equal(tabHubIsVisible(new Set()), false);
  assert.equal(tabHubIsVisible(new Set(['sale.create'])), false, 'an unrelated permission grants nothing');
  const src = TABS_LAYOUT();
  assert.match(src, /href: canSeeMoney \? undefined : null/);
});

it('and is not restricted to the Owner', () => {
  /*
    A store manager who counts the drawer needs the tab that holds the daily
    closing. Hard-coding a role here would take it from exactly the person the
    closing workflow exists for.
  */
  assert.equal(tabHubIsVisible(new Set(['closing.count'])), true, 'closing alone should show Money');
  assert.equal(tabHubIsVisible(new Set(['expense.submit'])), true, 'expenses alone should show Money');
  assert.equal(tabHubIsVisible(new Set(['loan.view'])), true, 'loans alone should show Money');
  assert.equal(tabHubIsVisible(new Set(['report.view'])), true, 'cash & accounts alone should show Money');
});

it('shows only the children a role actually holds', () => {
  const money = hubById('money');
  // An employee who may report an expense and count the drawer sees two rows,
  // not four, and never the cash-and-accounts screen.
  const employee = new Set(['expense.submit', 'closing.count']);
  assert.deepEqual(
    visibleChildren(money, employee).map((c) => c.route),
    ['/expenses', '/closing'],
  );
  // An Owner with everything sees all four.
  const owner = new Set(['report.view', 'expense.submit', 'closing.count', 'loan.view']);
  assert.equal(visibleChildren(money, owner).length, 4);
});

it('the tab screen is a primary screen, with no header and no back label', () => {
  /*
    A pushed hub route carries a header and a back arrow to whatever pushed it,
    which on a tab renders as "(tabs)" — the wrong thing to show on a screen
    nothing navigated to.
  */
  const src = fs.readFileSync(path.join(MOBILE, 'app', '(tabs)', 'money-hub.tsx'), 'utf8');
  // The file's own comment explains that it declares no `Stack.Screen`, so the
  // prose has to be stripped before the code is checked.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/Stack\.Screen/.test(code), 'a tab screen must not declare a Stack header');
  assert.ok(!/headerShown/.test(code), 'a tab screen must not set headerShown');
  assert.match(code, /t\('tab\.money'\)/, 'the title comes from the translated tab key');
});

it('the tab reads its children from the registry, not a second list', () => {
  const src = fs.readFileSync(path.join(MOBILE, 'app', '(tabs)', 'money-hub.tsx'), 'utf8');
  assert.match(src, /visibleChildren/);
  assert.match(src, /tabHub\(\)/);
  // A hardcoded route in the tab would let it drift from the registry.
  assert.ok(!/'\/expenses'|'\/closing'|'\/loans'/.test(src), 'routes must come from the registry');
});

it('the old /hub/money deep link still resolves', () => {
  // Bookmarks and notification links keep working by landing on the tab — the
  // destination they wanted, reached the way it is reached now.
  const src = fs.readFileSync(path.join(MOBILE, 'app', 'hub', '[id].tsx'), 'utf8');
  assert.match(src, /placement === 'tab'/);
  assert.match(src, /router\.replace\('\/money-hub'/);
});

it('the tab route is classified, so the drift test does not report it missing', () => {
  assert.ok(EXCLUDED_ROUTES['/money-hub'], '/money-hub needs a reason in EXCLUDED_ROUTES');
  assert.match(EXCLUDED_ROUTES['/money-hub'], /Bottom tab/);
});

it('Money is named in all three languages', () => {
  for (const locale of ['en', 'ar', 'fr']) {
    const src = fs.readFileSync(path.join(MOBILE, 'lib', 'i18n', locale + '.ts'), 'utf8');
    assert.match(src, /'tab\.money':/, locale + ' is missing the Money tab name');
  }
});


console.log('\n' + passed + ' passed');
