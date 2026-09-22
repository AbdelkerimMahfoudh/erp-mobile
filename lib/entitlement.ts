import { useQuery } from '@tanstack/react-query';
import { api } from './api-client';
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
