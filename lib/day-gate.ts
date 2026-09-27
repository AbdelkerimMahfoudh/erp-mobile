/**
 * Sell and Receive wait while the boutique's current business day is closed
 * (2026-09-27, `docs/59` D76). The store is opened again first — *Open store
 * now*, the reopen flow with its before-06:00 choice — by someone who may
 * (`closing.perform`; the server reopens its current day whenever it is closed).
 *
 * Read from the server's business day (`GET /closings/business-day`: always the
 * branch's current day, its standing), never from the phone's clock. A person
 * that view is not for (no `closing.count`), or a view not loaded yet, is not
 * held back by the phone: the server's own rule then stands — a sale reaching
 * a closed day reopens it (docs/21, 0076) — so nobody is locked out by a failed
 * read or by another person's cached answer.
 *
 * Pure, so it can be run directly under Node.
 */

import type { DayStanding } from './home-day';

export type DayGate = { locked: false } | { locked: true; mayOpen: boolean; businessDate: string };

export function dayGate(day: { standing: DayStanding; businessDate: string } | null | undefined, canPerform: boolean): DayGate {
  if (!day || day.standing !== 'closed') return { locked: false };
  return { locked: true, mayOpen: canPerform, businessDate: day.businessDate };
}
