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
  | 'Truck'
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
  | 'SlidersHorizontal'
  | 'ShieldCheck'
  | 'Smartphone'
  | 'RefreshCw';

export type HubId =
  | 'sales'
  | 'stock'
  | 'money'
  | 'network'
  | 'performance'
  | 'business'
  | 'account';

/** Where a hub is rendered on More. */
export type HubPlacement = 'business' | 'account';

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
      {
        id: 'suppliers',
        route: '/suppliers',
        titleKey: 'nav.suppliers',
        icon: 'Truck',
        anyOf: ['supplier.manage', 'supplier.payment.report'],
      },
      { id: 'imports', route: '/imports', titleKey: 'nav.imports', icon: 'FileSpreadsheet', perm: 'import.run' },
    ],
  },
  {
    id: 'money',
    titleKey: 'hub.money.title',
    descriptionKey: 'hub.money.desc',
    icon: 'Wallet',
    placement: 'business',
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
      { id: 'stores', route: '/stores', titleKey: 'nav.stores', icon: 'Building2', perm: 'connection.manage' },
      { id: 'consignments', route: '/consignments', titleKey: 'nav.consignments', icon: 'Handshake', perm: 'consignment.view' },
    ],
  },
  {
    id: 'performance',
    titleKey: 'hub.performance.title',
    descriptionKey: 'hub.performance.desc',
    icon: 'BarChart3',
    placement: 'business',
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
      { id: 'devices', route: '/devices', titleKey: 'nav.devices', icon: 'Smartphone' },
      // Reachable here even when the queue is empty, so its history can be
      // inspected without waiting for something to go wrong.
      { id: 'sync', route: '/sync', titleKey: 'nav.sync', icon: 'RefreshCw' },
    ],
  },
];

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
  '/sell': 'Bottom tab — Sell.',
  '/inventory': 'Bottom tab — Inventory.',
  '/more': 'Bottom tab — this screen itself.',
  '/login': 'Authentication, reached when signed out.',
  '/select-branch': 'Reached from the branch control at the top of More.',
  '/notifications': 'Reached from the notification bell in the More header.',
  '/receive': 'Started from Home and Inventory — a counter action, not a menu entry.',
  '/unit/[identifier]': 'Where a scan lands.',
  '/pricing/unit': 'Opened from a unit or the catalog.',
  '/pricing/history': 'Opened from a price.',
  '/discrepancies': 'Opened from the daily closing that raised the difference.',
  '/dev/gallery': 'Development-only design gallery, never linked from navigation.',
  '/hub/[id]': 'The hub container itself, generated from this registry.',
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
