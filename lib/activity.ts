/**
 * What a branch is subscribed to do (docs/21 D154, D156; docs/73).
 *
 * Three activities, chosen per branch on the subscription website: the
 * electronics store, the money services agent counter, or both. The phone
 * learns a branch's activity from `GET /entitlement` (`seatsByStore[].activity`)
 * — a flag, never a price — and uses it only to decide what is worth showing:
 * the server refuses a write the branch is not subscribed to on its own
 * (403 `activity_not_subscribed`), whatever the phone believes.
 *
 * An older server sends no activity at all. That reads as `electronics`, which
 * keeps today's app exactly as it is for every branch that existed before the
 * activity was introduced.
 *
 * Pure and dependency-free, so it runs directly under Node:
 *   node lib/activity.test.ts
 */

export type Activity = 'electronics' | 'money_agent' | 'both';

/** What a screen or a route needs: the store, or the counter. `both` satisfies either; nothing needs both at once. */
export type ActivityNeed = 'electronics' | 'money_agent';

export const ACTIVITIES: readonly Activity[] = ['electronics', 'money_agent', 'both'];

export function isActivity(value: unknown): value is Activity {
  return typeof value === 'string' && (ACTIVITIES as readonly string[]).includes(value);
}

/**
 * Whether a branch of this activity may do what something needs. No need at
 * all is always allowed. Fails closed on a word that is none of the three.
 */
export function activityAllows(activity: Activity, need: ActivityNeed | undefined): boolean {
  if (need === undefined) return true;
  return activity === 'both' || activity === need;
}

/** One branch's line of the entitlement, as far as the activity is concerned. */
export interface BranchActivityRow {
  branchId: string;
  activity?: unknown;
  activityNext?: unknown;
}

export interface EntitlementActivities {
  seatsByStore?: readonly BranchActivityRow[] | null;
}

/**
 * The activity of one branch, from the entitlement the server sent.
 *
 * `electronics` when the server did not say — no entitlement yet, no such
 * branch in it, or a server older than the activity — so nothing the shop could
 * do yesterday is taken away by a slow or an older server.
 */
export function branchActivity(entitlement: EntitlementActivities | null | undefined, branchId: string | null | undefined): Activity {
  if (!branchId) return 'electronics';
  const row = entitlement?.seatsByStore?.find((b) => b.branchId === branchId);
  return isActivity(row?.activity) ? row.activity : 'electronics';
}

/** A downgrade the Owner scheduled for the next renewal, or null — informational, never acted on by the phone. */
export function scheduledActivity(entitlement: EntitlementActivities | null | undefined, branchId: string | null | undefined): Activity | null {
  if (!branchId) return null;
  const row = entitlement?.seatsByStore?.find((b) => b.branchId === branchId);
  return isActivity(row?.activityNext) ? row.activityNext : null;
}
