/**
 * What the Home dashboard is allowed to work out for itself.
 *
 *   node lib/home-metrics.test.ts
 *
 * Deliberately tiny, and deliberately NOT where profit lives. Every money
 * figure on Home comes from the server — `/home` for the month's operating
 * result and `/analytics/summary` for the rest — because the shop already has
 * one definition of profit and a second one computed on a phone is how it ends
 * up with two answers and trusts neither.
 *
 * What is left is the handful of facts that are genuinely the client's: which
 * window "this month so far" means, how long a phone has been on the shelf, and
 * what the shop stands to make on the one in somebody's hand right now.
 *
 * Imports nothing, so it runs under bare node.
 */

/** An inclusive day window, as `/analytics/summary` expects it. */
export interface DayWindow {
  readonly from: string;
  readonly to: string;
}

/**
 * ⚠️ Period boundaries are UTC.
 *
 * There is no business-timezone setting anywhere in this product — the server
 * keys every rollup on a UTC `day` (`dayKey`), and `windowOf` slices a UTC
 * ISO string. Computing the month locally here would put the phone and the
 * server on different days either side of midnight, so this matches the server
 * rather than being independently "more correct".
 *
 * That agreement is the honest short answer, not the right long one: a shop
 * trading late in a UTC+2 evening has its takings land on tomorrow's figures.
 * Recorded as a contract gap rather than papered over — see `docs/21`.
 */
export function monthToDate(now: Date = new Date()): DayWindow {
  const to = now.toISOString().slice(0, 10);
  return { from: `${to.slice(0, 7)}-01`, to };
}

/**
 * How long this unit has been in stock, in whole days.
 *
 * Measured from `units.date_in`, which is set once when the purchase is
 * received and is never rewritten — a transfer moves the phone's branch and
 * leaves this alone, so a unit shuffled between shops does not reset to "new".
 *
 * Returns null when the server did not send a date rather than guessing zero:
 * "arrived today" and "we do not know when this arrived" are different answers,
 * and only one of them should ever reach a seller deciding on a price.
 */
export function daysInStock(dateIn: string | null | undefined, now: Date = new Date()): number | null {
  if (!dateIn) return null;
  const start = new Date(dateIn);
  if (Number.isNaN(start.getTime())) return null;
  const days = Math.floor((now.getTime() - start.getTime()) / 86_400_000);
  // A clock skewed behind the server must not report a negative age.
  return days < 0 ? 0 : days;
}

/**
 * What the shop stands to make on this sale, before it happens.
 *
 * Price minus cost, and nothing else — no discount model, no costing rule of
 * its own. Both numbers are the server's: `cost` is stripped entirely for
 * anybody without `cost.view`, and the price is whatever the seller is actually
 * proposing, discount already applied by the caller.
 *
 * Null when cost is absent, which is the permission case. A zero there would
 * claim the phone cost nothing, and a seller would read it as pure profit.
 */
export function expectedGrossProfit(
  proposedPrice: number | null | undefined,
  cost: number | null | undefined,
): number | null {
  if (typeof proposedPrice !== 'number' || typeof cost !== 'number') return null;
  return round2(proposedPrice - cost);
}

/**
 * Whether a figure on screen is old enough to say so.
 *
 * Home keeps showing the last answer when the network is gone — a blank screen
 * helps nobody at a counter — but a number with no date on it is presented as
 * current, and a shopkeeper cannot tell the difference. Anything past this says
 * when it was fetched.
 */
export const STALE_AFTER_MS = 5 * 60_000;

export function isStale(fetchedAt: number | null | undefined, now: number = Date.now()): boolean {
  if (!fetchedAt) return false;
  return now - fetchedAt > STALE_AFTER_MS;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
