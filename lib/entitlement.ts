import { useQuery } from '@tanstack/react-query';
import { businessAccess, type BusinessAccess } from './access';
import { branchActivity, companySells, scheduledActivity, type Activity } from './activity';
import { api } from './api-client';
import { useBranch } from './branch';
import { qk } from './query-keys';
import { refusedToStaff, type TrialSetupStatus } from './trial-setup';

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
  | 'rejected'
  /** Eligible for its one free trial, which has not started (0095). Closed, like `pending` — never "ended". */
  | 'trial_available'
  /** The free trial runs: writes, like a paid month, until the server's `trial.endsAt`. */
  | 'trial_active'
  /** The free trial ended and nothing paid followed: read-only, with no grace. */
  | 'trial_expired';

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

export interface ComplimentaryView {
  status: 'none' | 'indefinite' | 'active' | 'superseded' | 'ended';
  until: string | null;
  paidUntil: string | null;
}

/**
 * The one 7-day free trial, as the server tells it (0095). Rendered, never
 * recomputed: no hours divided into days, no duration added to a date. Its
 * instants are UTC, all three null while it is only available; `timeZone` is
 * the business's configured zone, the one they are shown in.
 */
export interface TrialView {
  status: 'available' | 'active' | 'expired';
  durationHours: number;
  durationDays: number;
  claimedAt: string | null;
  startedAt: string | null;
  endsAt: string | null;
  timeZone: string;
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
  /**
   * The platform grant, as the server reads it: running (`active`, with its end),
   * without an end (`indefinite`), overtaken by a later paid period (`superseded`)
   * or over. Absent on an older server.
   */
  complimentary?: ComplimentaryView;
  /** Per store, with each branch's activity (D156). Absent on an older server. */
  seatsByStore?: BranchSeat[];
  /** The free trial, when there is one to tell (0095). Absent on an older server. */
  trial?: TrialView | null;
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
 * The Owner's status of the free trial's setup instructions (0095), for the
 * closed screen of a business that has not started. Display data only: the
 * app reads it and can do nothing about it.
 *
 * The server answers it to the Owner alone; everybody else is refused (403),
 * which is the closed screen's answer for staff, not a failure to try again.
 */
export function useTrialSetup(enabled: boolean) {
  return useQuery({
    queryKey: qk.trialSetup(),
    queryFn: () => api.get<TrialSetupStatus>('/account/trial-setup'),
    enabled,
    retry: (failures, error) => !refusedToStaff(error) && failures < 1,
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
