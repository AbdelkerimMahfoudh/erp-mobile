import type { Permission } from '../permissions';
import type { TranslationKey } from '../i18n/keys';

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
 * `import type`, which TypeScript erases, so this module can be loaded by a
 * plain `node` test with no bundler. That is what makes the drift test in
 * `registry.test.ts` possible at all.
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
  | 'Users'
  | 'BadgeCheck'
  | 'BadgePercent'
  | 'SlidersHorizontal'
  | 'ShieldCheck'
  | 'Smartphone'
  | 'Palette'
  | 'RefreshCw';

export type HubId =
  | 'sales'
  | 'stock'
  | 'money'
  | 'network'
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
}

export interface Hub {
  readonly id: HubId;
  readonly titleKey: TranslationKey;
  readonly descriptionKey: TranslationKey;
  readonly icon: IconName;
  readonly placement: HubPlacement;
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
    children: [
      // Catalog stays ungated: Sell and Receive both depend on finding a
      // product, and the create/edit controls inside gate themselves.
      { id: 'catalog', route: '/catalog', titleKey: 'nav.catalog', icon: 'Tag' },
      { id: 'transfers', route: '/transfers', titleKey: 'nav.transfers', icon: 'ArrowLeftRight', perm: 'transfer.view' },
      // Opening stock, brought in once. Owner-only (`0073`); no supplier column.
      { id: 'imports', route: '/imports', titleKey: 'nav.imports', icon: 'FileSpreadsheet', perm: 'import.run' },
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
    children: [
      { id: 'money', route: '/money', titleKey: 'nav.money', icon: 'Landmark', perm: 'report.view' },
      // `expense.submit`, not `expense.manage`: the person who spent the money
      // reports it, and the list scopes them to their own.
      { id: 'expenses', route: '/expenses', titleKey: 'nav.expenses', icon: 'Receipt', perm: 'expense.submit' },
      // `closing.count`, not `closing.perform` — the Employee holding the
      // drawer must reach this screen; signing the day off is gated inside it.
      { id: 'closing', route: '/closing', titleKey: 'nav.closing', icon: 'ClipboardCheck', perm: 'closing.count' },
      { id: 'loans', route: '/loans', titleKey: 'nav.loans', icon: 'HandCoins', perm: 'loan.view' },
    ],
  },
  {
    id: 'network',
    titleKey: 'hub.network.title',
    descriptionKey: 'hub.network.desc',
    icon: 'Building2',
    placement: 'business',
    children: [
      // Two entries on purpose: finding a partner is Owner-level company trust,
      // running the consigned stock is operational and held by more people.
      // Partners is a tab now; this row keeps More's link to it and lands on the tab.
      { id: 'stores', route: '/partners', titleKey: 'nav.stores', icon: 'Building2', perm: 'connection.manage' },
      { id: 'consignments', route: '/consignments', titleKey: 'nav.consignments', icon: 'Handshake', perm: 'consignment.view' },
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
      // Ungated, as before: anyone may look at what the shop is entitled to.
      { id: 'subscription', route: '/subscription', titleKey: 'nav.subscription', icon: 'BadgeCheck' },
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
export type MoreGroupId = 'store' | 'team' | 'products' | 'security' | 'appearance' | 'account';

export interface MoreGroup {
  readonly id: MoreGroupId;
  readonly titleKey: TranslationKey;
  readonly destinationIds: readonly string[];
}

export const MORE_GROUPS: readonly MoreGroup[] = [
  {
    id: 'store',
    titleKey: 'more.group.store',
    destinationIds: ['sales', 'returns', 'approvals', 'transfers', 'imports', 'stores', 'consignments'],
  },
  { id: 'team', titleKey: 'more.group.team', destinationIds: ['team'] },
  { id: 'products', titleKey: 'more.group.products', destinationIds: ['catalog', 'settings'] },
  { id: 'security', titleKey: 'more.group.security', destinationIds: ['devices', 'sync'] },
  { id: 'appearance', titleKey: 'more.group.appearance', destinationIds: ['appearance'] },
  { id: 'account', titleKey: 'more.group.account', destinationIds: ['subscription'] },
];

/** The More groups this user may be offered, each with its permitted destinations; empty groups omitted. */
export function visibleGroups(granted: ReadonlySet<string>): { group: MoreGroup; destinations: Destination[] }[] {
  const byId = new Map(allDestinations().map((d) => [d.id, d]));
  return MORE_GROUPS.map((group) => ({
    group,
    destinations: group.destinationIds
      .map((id) => byId.get(id))
      .filter((d): d is Destination => d !== undefined && canSee(d, granted)),
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
  '/sell': 'The full sale — no longer a tab, still a route. Reached from Home and Quick Sell; kept so links and the saved cart keep working.',
  '/stores': 'Legacy link — redirects to the Partners tab.',
  '/partners/[id]': 'One store this shop deals with, opened from Partners.',
  '/inventory': 'Bottom tab — Inventory.',
  '/more': 'Bottom tab — this screen itself.',
  '/money-hub': 'Bottom tab — Money. Its children are registry destinations; the tab itself is a container, like /more.',
  '/login': 'Authentication, reached when signed out.',
  '/register': 'Creating an account, reached from the sign-in screen when signed out.',
  '/verify': 'Proving the contact for a registration in progress. Reached only from /register.',
  // Shown INSTEAD of the app when the server says the subscription blocks
  // operational access. Not a destination anybody navigates to on purpose.
  '/subscription-blocked': 'Subscription state screen, reached when the server refuses operational access.',
  '/select-branch': 'Reached from the branch control at the top of More.',
  '/notifications': 'Reached from the notification bell in the More header.',
  '/receive': 'Started from Home and Inventory — a counter action, not a menu entry.',
  // The Home shortcut, not a second Sell. It opens the camera on one phone and
  // leaves the Sell tab's cart alone; putting it in a menu would offer two
  // entries that look like the same thing and behave differently.
  '/quick-sell': 'The scan-first shortcut on Home — a counter action, not a menu entry.',
  '/quick-receive': 'The scan-first shortcut on Home — a counter action, not a menu entry. The full delivery workflow is /receive.',
  '/unit/[identifier]': 'Where a scan lands.',
  '/pricing/unit': 'Opened from a unit or the catalog.',
  '/pricing/history': 'Opened from a price.',
  '/discrepancies': 'Opened from the daily closing that raised the difference.',
  '/dev/gallery': 'Development-only design gallery, never linked from navigation.',
  '/hub/[id]': 'The hub container itself, generated from this registry.',
  '/approvals/[id]': 'One price approval, opened from the list or from the notification about it.',
};

/** Whether a destination should be offered, given what the server granted. */
export function canSee(destination: Destination, granted: ReadonlySet<string>): boolean {
  if (destination.perm && !granted.has(destination.perm)) return false;
  if (destination.anyOf && !destination.anyOf.some((p) => granted.has(p))) return false;
  return true;
}

/** The children of one hub this user may be offered, in registry order. */
export function visibleChildren(hub: Hub, granted: ReadonlySet<string>): Destination[] {
  return hub.children.filter((c) => canSee(c, granted));
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
): { hub: Hub; children: Destination[] }[] {
  return HUBS.filter((h) => placement === undefined || h.placement === placement)
    .map((hub) => ({ hub, children: visibleChildren(hub, granted) }))
    .filter((entry) => entry.children.length > 0);
}

/** One hub by id, or undefined for an unknown id. */
export function hubById(id: string): Hub | undefined {
  return HUBS.find((h) => h.id === id);
}

/** Every destination across every hub, for tests and audits. */
export function allDestinations(): Destination[] {
  return HUBS.flatMap((h) => h.children);
}

/** The hub rendered as a bottom tab, if there is one. */
export function tabHub(): Hub | undefined {
  return HUBS.find((h) => h.placement === 'tab');
}

/**
 * Whether the Money tab should appear at all.
 *
 * Visible when the user can reach **at least one** child. Deliberately not
 * Owner-only: a store manager who can count the drawer needs the tab that
 * holds the daily closing, and hard-coding a role here would take it away
 * from exactly the person the closing workflow exists for.
 *
 * When nothing is reachable the tab is removed entirely rather than shown
 * empty — a tab that opens onto nothing teaches people the app lies.
 */
export function tabHubIsVisible(granted: ReadonlySet<string>): boolean {
  const hub = tabHub();
  return hub !== undefined && visibleChildren(hub, granted).length > 0;
}
