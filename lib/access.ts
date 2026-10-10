import type { Entitlement, EntitlementState } from './entitlement';

/**
 * What the shop may do right now, read off the server's entitlement (docs/21,
 * 2026-10-05).
 *
 * One decision for every screen, so Home, Money, Stock, Partners and More never
 * disagree: the server's `canRead` and `canWrite` are READ, never derived — no
 * date arithmetic on the phone — and the four modes below are the only words
 * the app has for them. A closed shop (pending, suspended, cancelled, refused)
 * is shown the access screen instead of the app; a read-only one (the period and
 * its grace are over) keeps every read, every export and its own account, and
 * is offered no action the server would refuse; grace is the app as usual with
 * one restrained warning carrying the server's deadline; open is the app as
 * usual. Nothing here names a price, a payment or a way to buy: access is
 * arranged by the organisation, outside the app.
 *
 * Type-only import, so a plain `node` test can load this file.
 */
export type AccessMode = 'unknown' | 'open' | 'grace' | 'read_only' | 'closed';

export interface BusinessAccess {
  readonly mode: AccessMode;
  readonly state: EntitlementState | null;
  /**
   * Whether business writes are offered. Unknown reads as open on purpose: the
   * server refuses anyway, and a slow network must not take the counter away.
   */
  readonly canWrite: boolean;
  readonly canRead: boolean;
  readonly periodEnd: string | null;
  /** The server's exact grace deadline, shown verbatim in the grace warning. */
  readonly graceEnd: string | null;
  readonly overLimit: boolean;
  /** Shown as what the phone last knew, never as current. */
  readonly stale: boolean;
}

export function businessAccess(entitlement: Entitlement | undefined, stale = false): BusinessAccess {
  if (!entitlement) {
    return { mode: 'unknown', state: null, canWrite: true, canRead: true, periodEnd: null, graceEnd: null, overLimit: false, stale: true };
  }
  const base = {
    state: entitlement.state,
    periodEnd: entitlement.periodEnd,
    graceEnd: entitlement.graceEnd,
    overLimit: entitlement.overLimit,
    stale,
  };
  if (!entitlement.canRead) return { ...base, mode: 'closed', canRead: false, canWrite: false };
  if (!entitlement.canWrite) return { ...base, mode: 'read_only', canRead: true, canWrite: false };
  return { ...base, mode: entitlement.state === 'grace' ? 'grace' : 'open', canRead: true, canWrite: true };
}

export type AccessNoticeKind = 'none' | 'grace' | 'read_only' | 'over_limit';

/**
 * Whether the tabs say anything at all.
 *
 * An open, comfortably active shop is told nothing — a banner that is always
 * there is a banner nobody reads, and the end date lives on the access screen.
 * Read-only outranks grace, which outranks the staff allowance; the allowance
 * is only ever the Owner's business, because only the Owner can act on it.
 */
export function accessNotice(access: BusinessAccess, mayManageStaff: boolean): AccessNoticeKind {
  if (access.mode === 'read_only') return 'read_only';
  if (access.mode === 'grace') return 'grace';
  if (access.mode === 'open' && access.overLimit && mayManageStaff) return 'over_limit';
  return 'none';
}

/** The closed screen's words, from the server's state — never from a date. */
export type ClosedReason = 'pending' | 'suspended' | 'rejected' | 'ended';

export function closedReason(state: EntitlementState | undefined): ClosedReason {
  if (state === undefined || state === 'pending') return 'pending';
  if (state === 'suspended') return 'suspended';
  if (state === 'rejected') return 'rejected';
  return 'ended';
}

/**
 * The date the business's access runs to, for the access screen.
 *
 * While a platform grant runs, the paid period's end is not the answer: the
 * business is open until the LATER of the grant's end and the paid end, and a
 * grant without an end has no date at all (`null` — the screen then says the
 * access is active, without a date). A grant overtaken by a later paid period
 * runs to that period. Only the server's own dates are compared; nothing here
 * decides a state.
 */
export function accessEnd(entitlement: Entitlement | undefined): string | null {
  if (!entitlement) return null;
  const paid = entitlement.periodEnd;
  const grant = entitlement.complimentary;
  if (!grant) return paid;
  if (grant.status === 'indefinite') return null;
  if (grant.status === 'active') return later(paid, grant.until);
  if (grant.status === 'superseded') return later(paid, grant.paidUntil);
  return paid;
}

/** Both are the server's own `toISOString()` (UTC, fixed width), so text order is time order. */
function later(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return b > a ? b : a;
}
