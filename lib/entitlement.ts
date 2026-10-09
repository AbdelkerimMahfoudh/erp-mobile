import { useQuery } from '@tanstack/react-query';
import { businessAccess, type BusinessAccess } from './access';
import { branchActivity, companySells, scheduledActivity, type Activity } from './activity';
import { api } from './api-client';
import { useBranch } from './branch';
import { qk } from './query-keys';

/**
 * What the shop is entitled to (Milestone K).
 *
 * Every figure here is **calculated by the server**. Nothing in this file
 * derives a state, a remaining grace, a seat count or whether writes are
 * allowed: a client that decides its own entitlement is a client that can be
 * made to decide wrongly, and the server would refuse it anyway.
 */

export type EntitlementState =
  | 'pending'
  | 'active'
  | 'grace'
  | 'expired'
  | 'complimentary'
  | 'suspended'
  | 'cancelled'
  /** Refused at registration. Not "ended": nothing was ever granted. */
  | 'rejected';

/** Where an administrator has put the subscription. Distinct from the state. */
export type SubscriptionStatus =
  | 'pending_activation'
  | 'activated'
  | 'suspended'
  | 'cancelled'
  | 'rejected';

/**
 * One store's line of the entitlement: its seats, and — the one thing the phone
 * reads off it (D156) — what the branch is subscribed to do. `activity` is
 * absent on a server older than the activity, which reads as `electronics`.
 */
export interface BranchSeat {
  branchId: string;
  name: string;
  activity?: Activity;
  /** A downgrade waiting for the next renewal; informational. */
  activityNext?: Activity | null;
  seatsUsed: number;
  paidSeats: number;
  grantedSeats?: number;
  includedSeats: number;
  seatLimit: number;
  seatsAvailable: number;
  overLimit: boolean;
}

export interface Entitlement {
  state: EntitlementState;
  periodEnd: string | null;
  graceEnd: string | null;
  daysRemaining: number | null;
  graceHoursRemaining: number;
  subscribedBranchCount: number;
  activeBranchCount: number;
  includedSeats: number;
  additionalSeats: number;
  seatLimit: number;
  seatsUsed: number;
  overLimit: boolean;
  canRead: boolean;
  canWrite: boolean;
  isComplimentary: boolean;
  status: SubscriptionStatus;
  calculatedAt: string;
  /** Per store, with each branch's activity (D156). Absent on an older server. */
  seatsByStore?: BranchSeat[];
}

/** `enabled` lets the root gate ask only once there is a session to ask for. */
export function useEntitlement(enabled = true) {
  return useQuery({
    queryKey: qk.entitlement(),
    queryFn: () => api.get<Entitlement>('/entitlement'),
    enabled,
    // Checked often enough that a lapse is noticed within a shift, and cached
    // long enough that it is not asked on every screen change.
    staleTime: 5 * 60_000,
  });
}

/**
 * Whether what we are showing is known to be current.
 *
 * A cached entitlement that could not be re-verified is **stale**, never
 * current. Telling a shop its subscription is fine on the strength of a
 * three-day-old cache is exactly the confident lie this milestone must not
 * tell — and J's offline restrictions continue to apply on top regardless.
 */
export function isStale(query: { data?: Entitlement; isStale: boolean; isError: boolean }): boolean {
  if (!query.data) return true;
  return query.isError || query.isStale;
}

/**
 * What the shop may do right now, for every screen that offers an action
 * (`lib/access.ts`). One cached query behind it, so the tabs agree and nothing
 * is asked twice.
 */
export function useBusinessAccess(): BusinessAccess {
  const query = useEntitlement();
  return businessAccess(query.data, isStale(query));
}

/**
 * What the branch in use is subscribed to do (D156), from the same cached
 * entitlement — `electronics` until the server has said otherwise, so a slow
 * network or an older server leaves today's app exactly as it is. Read again
 * on a branch switch and when the app returns to the foreground, as the
 * permissions are (`hooks/useAuth.tsx`).
 */
export function useBranchActivity(): Activity {
  const branchId = useBranch((s) => s.branchId);
  const query = useEntitlement();
  return branchActivity(query.data, branchId);
}

/** Whether any branch of the company sells electronics — what the company's partner stores belong to (docs/73 §5.1). */
export function useCompanySells(): boolean {
  return companySells(useEntitlement().data);
}

/** A downgrade the Owner scheduled for the branch in use, or null. Said, never acted on. */
export function useScheduledActivity(): Activity | null {
  const branchId = useBranch((s) => s.branchId);
  const query = useEntitlement();
  return scheduledActivity(query.data, branchId);
}
