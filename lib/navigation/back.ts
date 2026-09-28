/**
 * Where the header's back arrow goes when there is nowhere to go back to.
 *
 * With history the arrow simply goes back — the same step as the swipe. Without
 * it (a notification, a deep link, a restored session, a cold start, a route
 * replaced), the arrow would otherwise do nothing, so every child route names
 * its logical parent here: a tab, or the screen it is normally opened from. A
 * parent may carry the route's own parameters (`/sales/pay/[id]` → that sale).
 *
 * Every route file is exactly one of (docs/61 §10):
 * - a **parent tab** — the five on the tab bar (`TAB_ROUTES`);
 * - a **child screen** with the shared back arrow (`BACK_PARENTS`);
 * - an **invisible redirect or bootstrap** — renders no page of its own and
 *   moves on at once (`REDIRECTS`, `BOOTSTRAP_FILE`);
 * - outside the signed-in app, an **authentication root** — signing in,
 *   choosing the branch, or the server's refusal of access — with its own way
 *   on (sign in, choose, check again, sign out), never counted as a child of
 *   the app (`AUTH_ROOTS`).
 * Modals and sheets are components with Close or Cancel, not routes. A
 * structural test (`back.test.ts`) refuses a route in none or two of these, so
 * a new screen cannot ship without an arrow or a decision. Pure — no imports —
 * so the test can load it under node.
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
  // Platform administration: its own identity. Its overview is entered from the sign-in screen, and goes back there;
  // the platform session stays until Sign out.
  '/platform': '/login',
  '/platform/[id]': '/platform',
  '/platform/new': '/platform',
  '/platform/audit': '/platform',
  '/platform/sign-in': '/login',
};

/** The five parent tabs, each with its reason. */
export const TAB_ROUTES: Readonly<Record<string, string>> = {
  '/': 'Home — a parent tab.',
  '/partners': 'Partners — a parent tab.',
  '/money-hub': 'Money — a parent tab.',
  '/inventory': 'Stock — a parent tab.',
  '/more': 'More — a parent tab.',
};

/** Routes that render no page of their own and move on at once. */
export const REDIRECTS: Readonly<Record<string, string>> = {
  '/stores': 'Renders only a redirect to the Partners tab (a legacy link). No parameters, no data; the tab bar is there when it lands.',
};

/** The splash while the session is restored: a spinner, then the sign-in guard moves on (`lib/navigation/entry.ts`). */
export const BOOTSTRAP_FILE = 'app/index.tsx';

/**
 * Before the signed-in app: each has its own way on and Sign out where a
 * session exists, and the sign-in guard sends anybody who leaves back here
 * until it is done — so an arrow would lead nowhere.
 */
export const AUTH_ROOTS: Readonly<Record<string, string>> = {
  '/login': 'Signing in — the start.',
  '/register': 'Creating an account, from sign-in, with its own way back.',
  '/verify': 'The code check after signing in or creating an account.',
  '/select-branch':
    'Choosing the branch — the last step of signing in. The app cannot be entered without a branch: switching from More clears the branch first, so the guard would bring any arrow straight back here. Choose one, or Sign out (always shown).',
  '/subscription-blocked':
    'The server refuses this shop access: shown instead of the app, and the guard returns here from anywhere in it. Check again, or Sign out.',
};

/** Routes that never draw the arrow: the tabs, the redirects and the authentication roots. */
export const NO_BACK: Readonly<Record<string, string>> = { ...TAB_ROUTES, ...REDIRECTS, ...AUTH_ROOTS };

/** Navigators nested in the root stack: they draw their own headers, so the root draws none for them. */
export const NESTED_NAVIGATORS: readonly string[] = ['platform'];

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
