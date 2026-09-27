/**
 * Where the header's back arrow goes when there is nowhere to go back to.
 *
 * With history the arrow simply goes back — the same step as the swipe. Without
 * it (a notification, a deep link, a restored session, a cold start, a route
 * replaced), the arrow would otherwise do nothing, so every child route names
 * its logical parent here: a tab, or the screen it is normally opened from. A
 * parent may carry the route's own parameters (`/sales/pay/[id]` → that sale).
 *
 * Signed-out screens (the `(auth)` group) keep their own stack and are not
 * covered. The five tabs and a few entry flows have no arrow at all; each is listed in
 * `NO_BACK` with the reason. A structural test (`back.test.ts`) refuses a route
 * that is in neither list, so a new screen cannot ship without an arrow or a
 * decision. Pure — no imports — so the test can load it under node.
 */

/** The five parent tabs. */
export const TABS = {
  home: '/',
  partners: '/partners',
  money: '/money-hub',
  stock: '/inventory',
  more: '/more',
} as const;

/** Child route → its logical parent. Patterns are expo-router's, e.g. `/sales/[id]`. */
export const BACK_PARENTS: Readonly<Record<string, string>> = {
  // Money
  '/money': TABS.money,
  '/sales/period': TABS.money,
  '/expenses': TABS.money,
  '/expenses/[id]': '/expenses',
  '/expenses/new': '/expenses',
  '/closing': TABS.money,
  '/closing/sources': '/closing',
  '/discrepancies': '/closing',
  '/discrepancies/[id]': '/discrepancies',
  '/loans': TABS.money,
  '/loans/[id]': '/loans',
  '/loans/new': '/loans',
  '/outstanding': TABS.money,
  // Home's counter actions
  '/quick-sell': TABS.home,
  '/quick-receive': TABS.home,
  '/sell': TABS.home,
  '/receive': TABS.home,
  '/receive/pick': '/receive',
  '/receive/file': '/receive',
  '/partners/ranking': TABS.home,
  // Stock
  '/transfers': TABS.stock,
  '/transfers/[id]': '/transfers',
  '/transfers/new': '/transfers',
  '/unit/[identifier]': TABS.stock,
  '/unit/edit': TABS.stock,
  '/pricing/unit': TABS.stock,
  '/pricing/history': TABS.stock,
  // Partners
  '/partners/[id]': TABS.partners,
  '/consignments': TABS.partners,
  '/consignments/[id]': '/consignments',
  '/consignments/new': '/consignments',
  // More
  '/sales': TABS.more,
  '/sales/[id]': '/sales',
  '/sales/pay/[id]': '/sales/[id]',
  '/returns': TABS.more,
  '/returns/[id]': '/returns',
  '/returns/new': '/returns',
  '/approvals': TABS.more,
  '/approvals/[id]': '/approvals',
  '/catalog': TABS.more,
  '/catalog/[id]': '/catalog',
  '/catalog/new': '/catalog',
  '/catalog/edit': '/catalog',
  '/catalog/categories': '/catalog',
  '/imports': TABS.more,
  '/imports/[id]': '/imports',
  '/analytics': TABS.more,
  '/alerts': '/analytics',
  '/goals': TABS.more,
  '/goals/new': '/goals',
  '/team': TABS.more,
  '/subscription': TABS.more,
  '/settings': TABS.more,
  '/appearance': TABS.more,
  '/devices': TABS.more,
  '/sync': TABS.more,
  '/notifications': TABS.more,
  '/hub/[id]': TABS.more,
  '/dev/gallery': TABS.more,
  // Platform administration: its own identity and its own overview.
  '/platform/[id]': '/platform',
  '/platform/new': '/platform',
  '/platform/audit': '/platform',
  '/platform/sign-in': '/login',
};

/** Routes with no back arrow, each with the reason. */
export const NO_BACK: Readonly<Record<string, string>> = {
  '/': 'Home — a parent tab.',
  '/partners': 'Partners — a parent tab.',
  '/money-hub': 'Money — a parent tab.',
  '/inventory': 'Stock — a parent tab.',
  '/more': 'More — a parent tab.',
  '/select-branch':
    'Choosing the branch — an entry flow reached by replacement after sign-in and from More; the choice replaces the whole app, so there is no earlier screen of this branch to return to. Sign out is offered.',
  '/subscription-blocked': 'Shown instead of the app when the server refuses access; nothing behind it to return to.',
  '/stores': 'A legacy link that immediately replaces itself with the Partners tab.',
  '/platform': 'The platform overview — the platform identity’s own home.',
};

/** A file under `app/` as the route pattern the router uses: groups and `index` dropped. */
export function routeOfFile(file: string): string {
  const parts = file
    .replace(/\\/g, '/')
    .replace(/^.*?app\//, '')
    .replace(/\.tsx$/, '')
    .split('/')
    .filter((p) => !/^\(.*\)$/.test(p) && p !== 'index');
  return '/' + parts.join('/');
}

/** A navigator route name (`sales/pay/[id]`, `(tabs)`, `index`) as the same pattern. */
export function routeOfName(name: string): string {
  return routeOfFile(`app/${name}.tsx`);
}

/**
 * The parent to go to for a route with no history, with the route's own
 * parameters filled in. A parent whose parameter is missing falls back to that
 * parameter's own parent, so the arrow never lands on a broken address.
 */
export function backTarget(route: string, params: Readonly<Record<string, unknown>> = {}): string {
  let target = BACK_PARENTS[route] ?? TABS.home;
  for (let hops = 0; hops < 4; hops += 1) {
    const missing = (target.match(/\[([^\]]+)\]/g) ?? []).some((m) => typeof params[m.slice(1, -1)] !== 'string');
    if (!missing) break;
    target = BACK_PARENTS[target] ?? TABS.home;
  }
  return target.replace(/\[([^\]]+)\]/g, (_, key: string) => encodeURIComponent(String(params[key])));
}
