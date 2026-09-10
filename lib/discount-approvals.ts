import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api-client';
import { useBranch } from './branch';
import { useConnectivity } from './connectivity';
import { usePermission } from './permissions';
import { qk } from './query-keys';
import type { ApprovalStatus, DiscountApproval } from './discount-approval-state';

/**
 * Asking the Owner to allow one sale below the set price, and answering (A2).
 *
 * ## Online only, and not by omission
 *
 * `lib/offline/policy.ts` classifies anything that **decides** something as
 * `online_only`, and an approval is nothing but a decision. A queued request
 * would be answered into a world that has moved; a queued grant would be a
 * decision made about a sale that may already have happened. So these hooks
 * refuse while disconnected and say so, rather than silently queueing.
 *
 * ## The client never concludes an approval exists
 *
 * Every function here reads or writes the server's row. Nothing derives an
 * approval, extends one, or treats a submitted request as a granted one. The
 * sale is completed by the server against its own record, and a phone that
 * inferred otherwise would show a person a discount they do not have.
 */

export interface ApprovalListResponse {
  rows: DiscountApproval[];
  /** `mine` for a requester, `company` for an approver. The server decides. */
  scope: 'mine' | 'company';
}

export interface RequestApprovalInput {
  unitId: string;
  requestedPrice: number;
  reason?: string;
  /** Retry safety. The same key replays the original decision, never a second. */
  clientUuid: string;
}

/**
 * The queue an Owner works, or the history a requester watches.
 *
 * Polled while the screen is open, because a decision arrives from another
 * person's phone and nothing pushes it here. Thirty seconds is slower than a
 * notification and faster than a person gives up; it stops when the screen is
 * not focused, so it costs nothing in a pocket.
 */
export function useDiscountApprovals(status?: ApprovalStatus, options?: { poll?: boolean }) {
  const branchId = useBranch((s) => s.branchId);
  const mayApprove = usePermission('discount.override');
  const online = useConnectivity((s) => s.online);

  return useQuery({
    queryKey: qk.discountApprovals(branchId, mayApprove ? 'company' : 'mine', status),
    queryFn: () =>
      api.get<ApprovalListResponse>(
        `/discount-approvals${status ? `?status=${status}` : ''}`,
      ),
    enabled: online,
    refetchInterval: options?.poll === false ? false : 30_000,
  });
}

/** One request — what a notification opens. */
export function useDiscountApproval(id: string) {
  const branchId = useBranch((s) => s.branchId);
  const online = useConnectivity((s) => s.online);

  return useQuery({
    queryKey: qk.discountApproval(branchId, id),
    queryFn: () => api.get<DiscountApproval>(`/discount-approvals/${id}`),
    enabled: online && Boolean(id),
    /*
     * A decision, an expiry or a sale can move this row while it is on screen.
     * Ten seconds keeps an Owner from approving something that lapsed while
     * they were reading it — and the server refuses anyway, so this is about
     * not showing a live button for a dead request rather than about safety.
     */
    refetchInterval: 10_000,
  });
}

/**
 * Everything outstanding for one unit, for the sale in progress.
 *
 * The Sell screen asks this to tell "you already asked" from "ask now", and to
 * notice the moment an Owner says yes. It is a **display** read: the sale still
 * submits and the server still decides.
 */
export function useApprovalsForUnit(unitId: string | null) {
  const branchId = useBranch((s) => s.branchId);
  const online = useConnectivity((s) => s.online);

  return useQuery({
    queryKey: qk.discountApprovalsForUnit(branchId, unitId ?? ''),
    queryFn: async () => {
      const page = await api.get<ApprovalListResponse>('/discount-approvals');
      return page.rows.filter((r) => r.unitId === unitId);
    },
    enabled: online && Boolean(unitId),
    refetchInterval: 10_000,
  });
}

/**
 * Everything that changes an approval invalidates the same three things.
 *
 * The list the person is looking at, the one row a deep link may be showing,
 * and the unit's outstanding requests that the Sell screen is watching. Missing
 * any one of them leaves a stale "pending" beside a decision that has been made.
 */
function useInvalidateApprovals() {
  const qc = useQueryClient();
  const branchId = useBranch((s) => s.branchId);

  return (id?: string, unitId?: string) => {
    void qc.invalidateQueries({ queryKey: ['discount-approvals'] });
    if (id) void qc.invalidateQueries({ queryKey: qk.discountApproval(branchId, id) });
    if (unitId) {
      void qc.invalidateQueries({ queryKey: qk.discountApprovalsForUnit(branchId, unitId) });
    }
    // The badge and the list behind it.
    void qc.invalidateQueries({ queryKey: qk.notifications });
  };
}

export function useRequestApproval() {
  const invalidate = useInvalidateApprovals();

  return useMutation({
    mutationFn: (input: RequestApprovalInput) =>
      api.post<DiscountApproval>('/discount-approvals', input),
    onSuccess: (row) => invalidate(row.id, row.unitId),
  });
}

export interface DecideInput {
  id: string;
  approve: boolean;
  note?: string;
  /**
   * The version the Owner was looking at.
   *
   * Two Owners deciding at once then produce one winner and one honest
   * conflict, rather than a silent last write in which somebody's rejection
   * quietly becomes somebody else's approval.
   */
  expectedVersion: number;
}

export function useDecideApproval() {
  const invalidate = useInvalidateApprovals();

  return useMutation({
    mutationFn: ({ id, ...body }: DecideInput) =>
      api.post<DiscountApproval>(`/discount-approvals/${id}/decide`, body),
    onSuccess: (row) => invalidate(row.id, row.unitId),
  });
}

export function useCancelApproval() {
  const invalidate = useInvalidateApprovals();

  return useMutation({
    mutationFn: (id: string) => api.post<DiscountApproval>(`/discount-approvals/${id}/cancel`),
    onSuccess: (row) => invalidate(row.id, row.unitId),
  });
}
