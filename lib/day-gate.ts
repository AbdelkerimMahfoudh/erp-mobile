/**
 * Sell and Receive wait while the boutique's current business day is closed
 * (2026-09-27, `docs/59` D76). The store is opened again first — *Open store
 * now*, the reopen flow with its before-06:00 choice — by someone who may
 * (`closing.perform`; the reopen acts on the server's current day whenever it is closed).
 *
 * Read from the server's business day (`GET /closings/business-day`: always the
 * branch's current day, its standing), never from the phone's clock. A person
 * that view is not for (no `closing.count`), or a view not loaded yet, is not
 * held back by the phone: the server's own rule then stands — a sale or a
 * receipt — or a later payment on a debt — reaching a closed day is refused
 * (`store_closed`), never a quiet reopen, so nobody is locked out by a failed
 * read or by another person's cached answer (docs/61).
 *
 * Pure, so it can be run directly under Node.
 */

import type { DayStanding } from './home-day';

/**
 * Why the counter waits: the day was closed — reopened by the Owner or a named
 * delegate (`closing.perform`) — or nobody has opened it yet, since the opening
 * carries the money the day starts with (docs/63) — opened by whoever counts
 * (`closing.count`).
 */
export type GateReason = 'closed' | 'not_opened';

export type DayGate = { locked: false } | { locked: true; reason: GateReason; mayOpen: boolean; businessDate: string };

export function dayGate(
  day: { standing: DayStanding; businessDate: string; door?: 'never_opened' | 'open' | 'closed' } | null | undefined,
  canPerform: boolean,
  canCount = canPerform,
): DayGate {
  if (!day) return { locked: false };
  if (day.standing === 'closed') return { locked: true, reason: 'closed', mayOpen: canPerform, businessDate: day.businessDate };
  // An older server sends no door: its counter never waited for an opening, and neither does the phone.
  if (day.door === 'never_opened') return { locked: true, reason: 'not_opened', mayOpen: canCount, businessDate: day.businessDate };
  return { locked: false };
}

/** Why a `store_closed` refusal came: the server's `closedReason` (docs/63); an older server's is always the closed day. */
export function closedReasonOf(error: unknown): GateReason | null {
  if (!isStoreClosedRefusal(error)) return null;
  return (error as { body?: { closedReason?: unknown } }).body?.closedReason === 'not_opened' ? 'not_opened' : 'closed';
}

/**
 * The server refused a sale or a receipt because the day is closed: nothing was
 * written. The phone's lock can be stale or not shown to this person, so this
 * answer can still arrive. Read from the API error's status and code — never
 * its sentence — and duck-typed, so this file stays free of the API client.
 */
export function isStoreClosedRefusal(error: unknown): boolean {
  const e = (error ?? {}) as { status?: unknown; code?: unknown };
  return e.status === 409 && e.code === 'store_closed';
}

/**
 * The closed business day a `store_closed` refusal names (the server sends it
 * as a field, never only in the sentence), or null for any other answer.
 */
export function closedDayOf(error: unknown): string | null {
  if (!isStoreClosedRefusal(error)) return null;
  const day = (error as { body?: { businessDate?: unknown } }).body?.businessDate;
  return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}
