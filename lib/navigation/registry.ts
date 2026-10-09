import type { Permission } from '../permissions';
import type { TranslationKey } from '../i18n/keys';
import { activityAllows, type Activity, type ActivityNeed } from '../activity.ts';
import { TABS, type TabId } from './back.ts';

/**
 * The single source of truth for what More contains (milestone N).
 *
 * More used to be a flat list of roughly twenty rows in which daily work,
 * financial workflows, reports, configuration and account controls were all
 * the same size and all equally loud. This file replaces that with six
 * containers, and — more importantly — puts the route/permission pairing in
 * ONE place, so a screen cannot quietly disagree with the menu about who may
 * see it.
 *
 * ## Deliberately data only
 *
 * No React, no icon components, no `expo-router`. Every import here is
 * `import type`, which TypeScript erases — or a pure sibling named with its
 * extension (`../activity.ts`, `./back.ts`), which plain `node` resolves the
 * way the offline modules are resolved — so this module can be loaded by a
 * `node` test with no bundler. That is what makes the drift test in
 * `registry.test.ts` possible at all.
 *
 * ## The activity dimension (docs/21 D156, D157)
 *
 * A branch is subscribed to the electronics store, the money services agent
 * counter, or both. A destination that belongs to one of them says so
 * (`activity`), and `canSee` hides it on a branch of the other — a Sell or a
 * Catalog row on an agent counter, an Exchanges row on a shop. `both` satisfies
 * either. The bar itself is `tabBarFor`: Home · Partners · Money · Stock · More
 * on a shop, unchanged; Home · Transactions · Money · Reports · More on an
 * agent-only branch; Home · Exchanges · Money · Stock · More on a combined one,
 * with Partners as a row of More and the agent reports a row of Money.
 *
 * Icons are named rather than imported for the same reason; the name is
 * resolved to a component in `components/navigation/hub-icons.ts`, whose
 * `Record<IconName, …>` type makes a missing icon a compile error.
 *
 * ## What this file is NOT
 *
 * It is navigation, not authorisation. The permissions below MIRROR what each
 * screen and the server already enforce — they decide what is worth showing,
 * never what is allowed. Hiding a row has never protected anything, and
 * removing one from here does not loosen a single server check.
 */

/** Icons used by hubs and their children. Resolved to components elsewhere. */
export type IconName =
  | 'ReceiptText'
  | 'Undo2'
  | 'Package'
  | 'Tag'
  | 'ArrowLeftRight'
  | 'FileSpreadsheet'
  | 'Wallet'
  | 'Landmark'
  | 'Receipt'
  | 'ClipboardCheck'
  | 'HandCoins'
  | 'Building2'
  | 'Handshake'
  | 'BarChart3'
  | 'Target'
  | 'Users'
  | 'BadgeCheck'
  | 'BadgePercent'
  | 'SlidersHorizontal'
  | 'ShieldCheck'
  | 'Smartphone'
  | 'Palette'
  | 'RefreshCw'
  | 'Clock'
  | 'CircleUserRound'
  | 'ArrowRightLeft'
  | 'ChartColumn'
  | 'Coins'
  | 'Scale'
  | 'Store';

export type HubId =
  | 'sales'
  | 'stock'
  | 'money'
  | 'agent'
  | 'network'
  | 'performance'
  | 'business'
  | 'account';

/**
 * Where a hub is rendered.
 *
 * `tab` is a **primary destination in the bottom bar**, not a card on More.
 * It is a placement rather than a separate concept so that one registry still
 * describes every entry point — a hub that moved to the tab bar must not also
 * have to be remembered somewhere else, or the two copies drift apart.
 */
export type HubPlacement = 'business' | 'account' | 'tab';

export interface Destination {
  /** Stable identity, independent of the route string. */
  readonly id: string;
  /** An EXISTING route. Milestone N renames no route and moves no file. */
  readonly route: string;
  readonly titleKey: TranslationKey;
  readonly icon: IconName;
  /** Required permission, when the row needs exactly one. */
  readonly perm?: Permission;
  /** Visible when the user holds ANY of these. */
  readonly anyOf?: readonly Permission[];
  /** The activity this screen belongs to; shown only on a branch subscribed to it (D156). Absent: every branch. */
  readonly activity?: ActivityNeed;
  /**
   * The company's rather than the branch's: still offered on More at a branch of another activity while the company
   * has a branch of its own activity (docs/73 §5.1) — the partner stores at an agent counter of a company with a shop.
   */
  readonly companyWide?: boolean;
}

export interface Hub {
  readonly id: HubId;
  readonly titleKey: TranslationKey;
  readonly descriptionKey: TranslationKey;
  readonly icon: IconName;
  readonly placement: HubPlacement;
  /** A `tab` hub's own tab, where its deep link lands. */
  readonly tab?: TabId;
  /** The activity the whole hub belongs to; its children inherit it. */
  readonly activity?: ActivityNeed;
  readonly children: readonly Destination[];
}

/**
 * The six business hubs, then the quieter account hub.
 *
 * Order is fixed and does not shuffle when a hub is hidden — a menu that
 * rearranges itself by role is a menu nobody can learn.
 *
 * Every `perm` / `anyOf` below is copied verbatim from what the old More
 * screen enforced, so no role gains or loses a single entry point.
 */
export const HUBS: readonly Hub[] = [
  {
    id: 'sales',
    titleKey: 'hub.sales.title',
    descriptionKey: 'hub.sales.desc',
    icon: 'ReceiptText',
    placement: 'business',
    // The store's own work: nothing here exists on an agent-only branch (D157).
    activity: 'electronics',
    children: [
      { id: 'sales', route: '/sales', titleKey: 'nav.sales', icon: 'ReceiptText', perm: 'sale.view' },
      { id: 'returns', route: '/returns', titleKey: 'nav.returns', icon: 'Undo2', perm: 'return.view' },
      /*
       * Price approvals (A2). Gated on `sale.create` rather than
       * `discount.override`, because everyone who may sell may also ASK — and
       * the server returns each of them only their own requests. An Owner
       * reaches the same row and receives the queue.
       */
      { id: 'approvals', route: '/approvals', titleKey: 'nav.approvals', icon: 'BadgePercent', perm: 'sale.create' },
    ],
  },
  {
    id: 'stock',
    titleKey: 'hub.stock.title',
    descriptionKey: 'hub.stock.desc',
    icon: 'Package',
    placement: 'business',
    activity: 'electronics',
    children: [
      // Catalog stays ungated: Sell and Receive both depend on finding a
      // product, and the create/edit controls inside gate themselves.
      { id: 'catalog', route: '/catalog', titleKey: 'nav.catalog', icon: 'Tag' },
      { id: 'transfers', route: '/transfers', titleKey: 'nav.transfers', icon: 'ArrowLeftRight', perm: 'transfer.view' },
      // Opening stock from a file is a Stock ACTION, not a menu row: it lives in
      // the Stock tab header (2026-10-05) and is excluded below with its reason.
    ],
  },
  {
    id: 'money',
    titleKey: 'hub.money.title',
    descriptionKey: 'hub.money.desc',
    icon: 'Wallet',
    /*
      A bottom tab, beside Sell (CP2).

      Money is the second thing a shopkeeper opens after selling, and it sat
      two taps away behind More. Changing this one field is what moves it:
      `visibleHubs('business')` no longer returns it, so the card disappears
      from More in the same edit that puts it in the bar — there is no
      moment where both exist.
    */
    placement: 'tab',
    tab: 'money',
    children: [
      // `/money` is the Results screen: profit for the period Money shows — the
      // store's sales less what they cost, which an agent counter has none of.
      { id: 'money', route: '/money', titleKey: 'nav.results', icon: 'BarChart3', perm: 'report.view', activity: 'electronics' },
      // `expense.submit`, not `expense.manage`: the person who spent the money
      // reports it, and the list scopes them to their own. Every branch has expenses.
      { id: 'expenses', route: '/expenses', titleKey: 'nav.expenses', icon: 'Receipt', perm: 'expense.submit' },
      { id: 'loans', route: '/loans', titleKey: 'nav.loans', icon: 'HandCoins', perm: 'loan.view' },
      // Balances customers and partner stores still owe (0074). `report.view`,
      // like the figures: the whole branch's receivables are an Owner and
      // Manager question. Quiet on purpose — a row, not a banner. Owed on sales,
      // so a store's.
      { id: 'outstanding', route: '/outstanding', titleKey: 'nav.outstanding', icon: 'Clock', perm: 'report.view', activity: 'electronics' },
    ],
  },
  {
    id: 'agent',
    titleKey: 'hub.agent.title',
    descriptionKey: 'hub.agent.desc',
    icon: 'ArrowRightLeft',
    /*
      The Money Services Agent counter (docs/73 §5.1, D157): a bottom tab on a
      branch subscribed to it — Transactions on an agent-only branch, Exchanges
      beside Stock on a combined one — and nothing at all on a shop. Its
      children are reached from the tabs, from Home and from Money, never from
      More: the counter flow is Home's big action, the reports are the
      agent-only branch's own tab (a combined branch finds them on Money beside
      Results), rebalancing and the providers are rows of Money (`moneyRows`).
    */
    placement: 'tab',
    tab: 'agent',
    activity: 'money_agent',
    children: [
      // The tab itself, as Partners is for the stores: a deep link lands on it.
      { id: 'agent-transactions', route: TABS.agent, titleKey: 'nav.agent.transactions', icon: 'ArrowRightLeft', perm: 'agent.transaction.view' },
      // The counter flow: Home's one big action on an agent branch, and the Transactions tab's header.
      { id: 'agent-new', route: '/agent/new', titleKey: 'nav.agent.new', icon: 'HandCoins', perm: 'agent.transaction.record' },
      { id: 'agent-reports', route: '/agent/reports', titleKey: 'nav.agent.reports', icon: 'ChartColumn', perm: 'agent.report.view' },
      // Money moved between the drawer and the floats, never an exchange (A8): the Owner and a Manager.
      { id: 'agent-rebalance', route: '/agent/rebalance', titleKey: 'nav.agent.rebalance', icon: 'Scale', perm: 'agent.rebalance' },
      // Rates and settlement, read from each provider's real schedule: the Owner alone (docs/73 §7).
      { id: 'agent-providers', route: '/agent/providers', titleKey: 'nav.agent.providers', icon: 'Store', perm: 'agent.provider.manage' },
      // The drawer, each float and each held commission now — the whole of Home's floats card.
      { id: 'agent-positions', route: '/agent/positions', titleKey: 'nav.agent.positions', icon: 'Coins', perm: 'agent.transaction.view' },
    ],
  },
  {
    id: 'network',
    titleKey: 'hub.network.title',
    descriptionKey: 'hub.network.desc',
    icon: 'Building2',
    placement: 'business',
    // Stock held between shops: a store's business, not an agent counter's.
    activity: 'electronics',
    children: [
      /*
        Two entries on purpose: finding a partner is Owner-level company trust,
        running the consigned stock is operational and held by more people.
        Partners is a tab on an electronics shop; on a combined branch the tab
        bar is full and this row IS the way to the Partners screen (D157), so
        it is shown to whoever the tab was shown to — anybody who may see the
        stores this shop deals with, or manage who it deals with — never to the
        Owner alone.
      */
      { id: 'stores', route: '/partners', titleKey: 'nav.stores', icon: 'Building2', anyOf: ['consignment.view', 'connection.manage'], companyWide: true },
      { id: 'consignments', route: '/consignments', titleKey: 'nav.consignments', icon: 'Handshake', perm: 'consignment.view' },
    ],
  },
  {
    id: 'performance',
    titleKey: 'hub.performance.title',
    descriptionKey: 'hub.performance.desc',
    icon: 'BarChart3',
    placement: 'business',
    // Sales analyses and sales targets: the store's; the counter's reports are its own tab.
    activity: 'electronics',
    children: [
      { id: 'analytics', route: '/analytics', titleKey: 'nav.analytics', icon: 'BarChart3', perm: 'report.view' },
      // Ungated: an employee with a personal target must be able to see it, and
      // the list scopes somebody without `goal.manage` to their own.
      { id: 'goals', route: '/goals', titleKey: 'nav.goals', icon: 'Target' },
    ],
  },
  {
    id: 'business',
    titleKey: 'hub.business.title',
    descriptionKey: 'hub.business.desc',
    icon: 'Users',
    placement: 'business',
    children: [
      { id: 'team', route: '/team', titleKey: 'nav.team', icon: 'Users', perm: 'user.manage' },
      // Ungated: anyone may see where the business's access stands. Status and dates only — no price, no action (docs/21, 2026-10-05).
      { id: 'access', route: '/access', titleKey: 'nav.access', icon: 'BadgeCheck' },
      { id: 'settings', route: '/settings', titleKey: 'nav.settings', icon: 'SlidersHorizontal', perm: 'settings.manage' },
    ],
  },
  {
    id: 'account',
    titleKey: 'hub.account.title',
    descriptionKey: 'hub.account.desc',
    icon: 'ShieldCheck',
    placement: 'account',
    children: [
      // The person's own account (docs/64): who they are, the WhatsApp number
      // their security codes go to, and the way to delete the account. First,
      // and ungated: every login has one, whatever the shop's subscription says.
      { id: 'account', route: '/account', titleKey: 'nav.account', icon: 'CircleUserRound' },
      // How the app LOOKS and what it SPEAKS — personal preferences, not
      // business configuration, which is why they are here and not in the
      // store-wide Settings screen.
      { id: 'appearance', route: '/appearance', titleKey: 'nav.appearance', icon: 'Palette' },
      { id: 'devices', route: '/devices', titleKey: 'nav.devices', icon: 'Smartphone' },
      // Reachable here even when the queue is empty, so its history can be
      // inspected without waiting for something to go wrong.
      { id: 'sync', route: '/sync', titleKey: 'nav.sync', icon: 'RefreshCw' },
    ],
  },
];

/**
 * How More presents the destinations: grouped sections, one tap to a screen.
 *
 * The hubs above still own membership, permissions and the `/hub/[id]` deep
 * links; this is only the order and grouping More shows. It names destinations
 * by id, so it cannot introduce a route, and the drift test requires every
 * business and account destination to appear here exactly once. Money is a tab
 * and is deliberately absent.
 */
export type MoreGroupId = 'activity' | 'reports' | 'manage' | 'account';

export interface MoreGroup {
  readonly id: MoreGroupId;
  readonly titleKey: TranslationKey;
  readonly destinationIds: readonly string[];
}

export const MORE_GROUPS: readonly MoreGroup[] = [
  // Partner stores and consignments are listed here only while the Partners tab is off the bar (a combined branch).
  { id: 'activity', titleKey: 'more.group.activity', destinationIds: ['sales', 'returns', 'approvals', 'stores', 'consignments'] },
  { id: 'reports', titleKey: 'more.group.reports', destinationIds: ['analytics', 'goals'] },
  { id: 'manage', titleKey: 'more.group.manage', destinationIds: ['team', 'catalog', 'settings'] },
  { id: 'account', titleKey: 'more.group.account', destinationIds: ['account', 'appearance', 'access', 'devices', 'sync'] },
];

/**
 * Destinations NOT repeated on More while the bottom tab that leads to them is
 * on the bar — each with which tab, and where on it. They stay registry
 * destinations (their `/hub/[id]` deep links and permissions are unchanged);
 * More simply does not list the same screen a second time. When the tab is not
 * on the bar — Partners on a combined branch (D157) — the row is the way there.
 */
export const REACHED_FROM_TABS: Readonly<Record<string, { tab: TabId; where: string }>> = {
  transfers: { tab: 'stock', where: 'Stock tab — the transfers button in its header.' },
  stores: { tab: 'partners', where: 'Partners tab — it is this list.' },
  consignments: { tab: 'partners', where: 'Partners tab — the Consignments row under the stores.' },
};

/**
 * The More groups this user may be offered on a branch of this activity, each
 * with its permitted destinations; empty groups omitted. A destination whose
 * tab is on the bar is left to the tab. What belongs to the company rather than
 * the branch stays on More at a branch of another activity while the company
 * has one of its own (`companyWide`, docs/73 §5.1).
 */
export function visibleGroups(
  granted: ReadonlySet<string>,
  activity: Activity = 'electronics',
  companySells = true,
): { group: MoreGroup; destinations: Destination[] }[] {
  const byId = new Map(allDestinations().map((d) => [d.id, d]));
  const bar = tabBarFor(activity, granted);
  const offered = (d: Destination) => canSee(d, granted, activity) || (d.companyWide === true && companySells && canSee(d, granted, 'electronics'));
  return MORE_GROUPS.map((group) => ({
    group,
    destinations: group.destinationIds
      .map((id) => byId.get(id))
      .filter((d): d is Destination => d !== undefined && offered(d))
      .filter((d) => !(d.id in REACHED_FROM_TABS && bar.includes(REACHED_FROM_TABS[d.id].tab))),
  })).filter((entry) => entry.destinations.length > 0);
}

/**
 * Routes that exist but are deliberately not hub children, each with the reason.
 *
 * The drift test refuses an unclassified route, so adding a screen forces a
 * decision here rather than letting it quietly become unreachable — which is
 * exactly how Suppliers went missing from More for a whole milestone
 * (`docs/29` S2).
 */
export const EXCLUDED_ROUTES: Readonly<Record<string, string>> = {
  '/': 'Bottom tab — Home.',
  '/sell': 'The full sale — no longer a tab, still a route. Reached from Quick Sell (Home’s Sell, docs/59 D75); kept so links and the saved cart keep working.',
  '/stores': 'Legacy link — redirects to the Partners tab.',
  '/closing': 'The Daily closing — reached from Home’s Daily closing card (Review closing), no longer a row of Money (docs/63). Everybody who counts (`closing.count`) reaches it there.',
  '/partners/[id]': 'One store this shop deals with, opened from Partners.',
  '/inventory': 'Bottom tab — Inventory.',
  '/imports':
    'Import stock — opening stock from a spreadsheet. A Stock action opened from the Stock tab header (2026-10-05), Owner-only (`0073`, `import.run`); no longer a More row or a hub child, so the one place to start it is the one place stock is looked at.',
  '/imports/[id]': 'One stock file being checked before anything is added, opened from Import stock.',
  '/more': 'Bottom tab — this screen itself.',
  '/money-hub': 'Bottom tab — Money. Its children are registry destinations; the tab itself is a container, like /more.',
  '/agent-reports': 'Bottom tab — Reports of an agent-only branch (D157): the same screen as /agent/reports, which a combined branch reaches from Money. A container, like /money-hub.',
  '/agent/[id]': 'One exchange of the agent counter, opened from the Transactions tab.',
  '/login': 'Authentication, reached when signed out. Accounts are set up by the organisation; the app offers no self-registration (docs/21, 2026-10-05).',
  // Shown INSTEAD of the app when the server says the business is closed
  // (pending, suspended, cancelled, refused). Not a destination anybody navigates to on purpose.
  '/access-closed': 'The access screen of a closed business, reached when the server refuses operational access.',
  '/select-branch': 'Reached from the branch control at the top of More.',
  '/notifications': 'Reached from the notification bell in the More header.',
  '/alerts': 'Every alert to review, newest first — the rest of the Analyses overview’s "Needs your attention", reached from its "View all".',
  '/receive': 'Started from Home and Inventory — a counter action, not a menu entry.',
  '/receive/pick': 'Choosing a stock file, from the Receive stock header. Owner-only, like the opening-inventory import.',
  '/receive/file': 'Checking a delivery read out of a file, before any of it is received.',
  '/sales/period': 'Every sale in the Money period, from the overview’s View all sales — a detail of Money, not a menu entry.',
  '/sales/pay/[id]': 'Recording a later payment, opened from the sale it pays for.',
  // The Home shortcut, not a second Sell. It opens the camera on one phone and
  // leaves the Sell tab's cart alone; putting it in a menu would offer two
  // entries that look like the same thing and behave differently.
  '/quick-sell': 'The scan-first shortcut on Home — a counter action, not a menu entry.',
  '/quick-receive': 'The scan-first shortcut on Home — a counter action, not a menu entry. The full delivery workflow is /receive.',
  '/unit/[identifier]': 'Where a scan lands.',
  '/unit/edit': 'Correcting one unit, opened from the pencil on its detail — never a menu entry.',
  '/pricing/unit': 'Opened from a unit or the catalog.',
  '/pricing/history': 'Opened from a price.',
  '/discrepancies': 'Opened from the daily closing that raised the difference.',
  '/closing/sources': '"Correct a transaction" — the records of one business date, reached from the Daily closing (/closing).',
  '/partners/ranking': 'Boutique ranking — reached from Home’s Top boutique card.',
  '/dev/gallery': 'Development-only design gallery, never linked from navigation.',
  '/hub/[id]': 'The hub container itself, generated from this registry.',
  '/approvals/[id]': 'One price approval, opened from the list or from the notification about it.',
};

/**
 * Screens whose only purpose is a business write, each with what it writes.
 *
 * A read-only business (the period and its grace are over; the server refuses
 * every business write) is not offered these: the sign-in guard sends an
 * opened link to the access screen, which explains, instead of a form that
 * fails at the end (docs/21, 2026-10-05). Mixed screens — a sale's detail with
 * its payment, a team list with its switches — stay readable, and the server's
 * refusal is shown where an action is tried. Patterns are expo-router's.
 */
export const WRITE_ONLY_ROUTES: Readonly<Record<string, string>> = {
  '/quick-sell': 'A sale.',
  '/sell': 'The full sale.',
  '/quick-receive': 'Receiving one phone.',
  '/receive': 'Receiving stock.',
  '/receive/pick': 'Receiving stock from a file.',
  '/receive/file': 'Receiving stock from a file.',
  '/sales/pay/[id]': 'A payment on a sale.',
  '/expenses/new': 'An expense.',
  '/transfers/new': 'A transfer.',
  '/consignments/new': 'A consignment.',
  '/loans/new': 'A loan.',
  '/returns/new': 'A return.',
  '/goals/new': 'A target.',
  '/catalog/new': 'A product.',
  '/catalog/edit': 'A product change.',
  '/unit/edit': 'A stock correction.',
  '/pricing/unit': 'A price.',
  // The agent counter's two forms (D157): an exchange recorded, money moved between the drawer and the floats.
  '/agent/new': 'An agent exchange.',
  '/agent/rebalance': 'A rebalancing of the drawer and the floats.',
};

/** Whether a path the router reports (`/sales/pay/0190-ab`) is one of the write-only screens: segment by segment, a `[param]` matching any one segment. */
export function isWriteOnlyRoute(pathname: string): boolean {
  const path = (pathname.replace(/\/+$/, '') || '/').split('/');
  return Object.keys(WRITE_ONLY_ROUTES).some((pattern) => {
    const parts = pattern.split('/');
    return parts.length === path.length && parts.every((part, i) => (part.startsWith('[') && part.endsWith(']') ? path[i].length > 0 : part === path[i]));
  });
}

/**
 * Whether a destination should be offered, given what the server granted and
 * what the branch is subscribed to. The activity defaults to `electronics`,
 * which is what every branch is on a server older than the activity — so a
 * caller that does not know keeps today's app.
 */
export function canSee(destination: Destination, granted: ReadonlySet<string>, activity: Activity = 'electronics'): boolean {
  if (destination.perm && !granted.has(destination.perm)) return false;
  if (destination.anyOf && !destination.anyOf.some((p) => granted.has(p))) return false;
  const hub = HUBS.find((h) => h.children.includes(destination));
  return activityAllows(activity, destination.activity ?? hub?.activity);
}

/** The children of one hub this user may be offered on a branch of this activity, in registry order. */
export function visibleChildren(hub: Hub, granted: ReadonlySet<string>, activity: Activity = 'electronics'): Destination[] {
  return hub.children.filter((c) => canSee(c, granted, activity));
}

/**
 * The hubs worth showing, in fixed registry order.
 *
 * A hub with no reachable child is omitted entirely rather than rendered empty:
 * a container that opens onto nothing teaches people the menu lies.
 */
export function visibleHubs(
  granted: ReadonlySet<string>,
  placement?: HubPlacement,
  activity: Activity = 'electronics',
): { hub: Hub; children: Destination[] }[] {
  return HUBS.filter((h) => placement === undefined || h.placement === placement)
    .map((hub) => ({ hub, children: visibleChildren(hub, granted, activity) }))
    .filter((entry) => entry.children.length > 0);
}

/** One hub by id, or undefined for an unknown id. */
export function hubById(id: string): Hub | undefined {
  return HUBS.find((h) => h.id === id);
}

/** One destination by id; a wrong id is a programming error, said loudly. */
function destination(id: string): Destination {
  const found = allDestinations().find((d) => d.id === id);
  if (!found) throw new Error(`no destination "${id}" in the navigation registry`);
  return found;
}

/** Every destination across every hub, for tests and audits. */
export function allDestinations(): Destination[] {
  return HUBS.flatMap((h) => h.children);
}

/** The Money hub — the first hub that became a tab (CP2); the agent counter's is `hubById('agent')`. */
export function tabHub(): Hub | undefined {
  return hubById('money');
}

/**
 * Whether the Partners tab is worth showing: to anybody who can see the stores
 * this shop deals with, or manage who it deals with — the `stores` destination's
 * own rule, so the tab and the More row that stands in for it never disagree.
 */
export function partnersTabVisible(granted: ReadonlySet<string>): boolean {
  return canSee(destination('stores'), granted, 'electronics');
}

/**
 * The rows the Money tab offers under its figures, in reading order: the Money
 * hub's own children, with the agent counter's reports beside Results and its
 * rebalancing and providers after — only on a branch subscribed to the counter.
 * The reports are a row only where they are not a tab of their own: an
 * agent-only branch has them on the bar, a combined branch finds them here
 * (D157). Decided by the activity alone, so the bar and these rows never ask
 * each other.
 */
const MONEY_ROW_ORDER = ['money', 'agent-reports', 'expenses', 'loans', 'outstanding', 'agent-rebalance', 'agent-providers'] as const;

export function moneyRows(granted: ReadonlySet<string>, activity: Activity = 'electronics'): Destination[] {
  const reportsOnTheBar = activity === 'money_agent';
  return MONEY_ROW_ORDER.map((id) => destination(id))
    .filter((d) => canSee(d, granted, activity))
    .filter((d) => !(d.id === 'agent-reports' && reportsOnTheBar));
}

/**
 * Whether the Money tab should appear at all.
 *
 * Visible when the user can reach **at least one** of its rows. Deliberately
 * not Owner-only: a store manager who can count the drawer needs the tab that
 * holds the daily closing, and hard-coding a role here would take it away
 * from exactly the person the closing workflow exists for.
 *
 * When nothing is reachable the tab is removed entirely rather than shown
 * empty — a tab that opens onto nothing teaches people the app lies.
 */
export function tabHubIsVisible(granted: ReadonlySet<string>, activity: Activity = 'electronics'): boolean {
  return moneyRows(granted, activity).length > 0;
}

/**
 * The bottom bar of a branch, by its activity and the role (docs/73 §5.1, D157):
 *
 *  - a shop (`electronics`): Home · Partners · Money · Stock · More — unchanged;
 *  - an agent-only branch (`money_agent`): Home · Transactions · Money · Reports · More,
 *    with no Stock, no Partners and no Sell anywhere;
 *  - a combined branch (`both`): Home · Exchanges · Money · Stock · More — five,
 *    never six: Partners becomes a row of More, the agent reports a row of Money.
 *
 * Each tab still needs its permission: a tab that 403s on tap is worse than
 * none. Order is fixed; a hidden tab is simply absent.
 */
export function tabBarFor(activity: Activity, granted: ReadonlySet<string>): TabId[] {
  const sells = activityAllows(activity, 'electronics');
  const exchanges = activityAllows(activity, 'money_agent');
  const tabs: TabId[] = ['home'];
  if (sells && !exchanges && partnersTabVisible(granted)) tabs.push('partners');
  if (exchanges && canSee(destination('agent-transactions'), granted, activity)) tabs.push('agent');
  if (tabHubIsVisible(granted, activity)) tabs.push('money');
  if (sells) tabs.push('stock');
  if (exchanges && !sells && canSee(destination('agent-reports'), granted, activity)) tabs.push('agentReports');
  tabs.push('more');
  return tabs;
}

/** Where a tab hub's deep link (`/hub/money`, `/hub/agent`) lands: its own tab. */
export function tabRouteOf(hub: Hub): string {
  return TABS[hub.tab ?? 'money'];
}

/** The name a tab is drawn with: the agent tab says Transactions on its own branch and Exchanges beside Stock. */
export function tabLabelKey(tab: TabId, activity: Activity): TranslationKey {
  switch (tab) {
    case 'home':
      return 'tab.home';
    case 'partners':
      return 'tab.partners';
    case 'agent':
      return activity === 'both' ? 'tab.exchanges' : 'tab.transactions';
    case 'money':
      return 'tab.money';
    case 'stock':
      return 'tab.inventory';
    case 'agentReports':
      return 'tab.reports';
    default:
      return 'tab.more';
  }
}
