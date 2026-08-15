import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from './api-client';
import { useBranch } from './branch';
import { qk } from './query-keys';
import { t } from './i18n';
import { toast } from './toast';
import type {
  ReturnAdjustmentKind,
  ReturnDetail,
  ReturnPage,
  ReturnResponsibility,
  ReturnStatus,
  RefundMethod,
  RefundReceipt,
  RefundSummary,
} from '../types/api';

/**
 * The mobile side of the return workflow.
 *
 * **The server owns every decision.** Nothing here computes a refund, judges
 * eligibility, or assumes a unit changed status — the detail response says what
 * is true and this file renders it. The app's jobs are asking the right
 * question, sending the version it last saw, and refreshing exactly what
 * changed.
 *
 * Every write takes `expectedVersion`. A stale one is a 409 `refresh_required`,
 * which is handled by refetching and showing the outcome that actually won,
 * rather than by retrying blindly over somebody else's decision.
 */

export interface ReturnFilters {
  status?: ReturnStatus[];
  search?: string;
}

export function returnsQueryString(filters: ReturnFilters): string {
  const p = new URLSearchParams();
  if (filters.status?.length) p.set('status', filters.status.join(','));
  if (filters.search?.trim()) p.set('search', filters.search.trim());
  return p.toString();
}

/**
 * The return list, paged by the server.
 *
 * Every server-side parameter is in the query key: a cursor issued under one
 * query is meaningless under another, so changing a filter, the search or the
 * branch must start a fresh run rather than continue the previous one.
 */
export function useReturns(filters: ReturnFilters) {
  const branchId = useBranch((s) => s.branchId);
  const qs = returnsQueryString(filters);

  return useInfiniteQuery({
    queryKey: qk.returns(branchId, qs),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams(qs);
      if (pageParam) p.set('cursor', pageParam);
      const suffix = p.toString();
      return api.get<ReturnPage>(`/returns${suffix ? `?${suffix}` : ''}`);
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useReturn(id: string | undefined) {
  return useQuery({
    queryKey: qk.return(id ?? ''),
    enabled: Boolean(id),
    queryFn: () => api.get<ReturnDetail>(`/returns/${id}`),
  });
}

/** Everything a write needs to refresh afterwards. */
function useRefresh(id?: string) {
  const qc = useQueryClient();
  const branchId = useBranch((s) => s.branchId);
  return () => {
    if (id) void qc.invalidateQueries({ queryKey: qk.return(id) });
    void qc.invalidateQueries({ queryKey: ['returns', branchId] });
  };
}

/**
 * What a REFUND write changes, which is much more than a return.
 *
 * Reporting is a workflow event, but confirming moves cash on the day it
 * happens: expected cash falls, the liability settles, the closing figures
 * shift and somebody gets a notification. Refreshing only the return would
 * leave a till screen quoting a number that stopped being true.
 *
 * Prefixes, not exact keys — every one of these is keyed by branch and often by
 * a date or filter, and an exact key would miss the variant actually on screen.
 */
function useRefundRefresh(id?: string) {
  const qc = useQueryClient();
  const branchId = useBranch((s) => s.branchId);
  return () => {
    if (id) {
      void qc.invalidateQueries({ queryKey: qk.return(id) });
      void qc.invalidateQueries({ queryKey: qk.refundReceipt(branchId, id) });
    }
    for (const prefix of [
      ['returns', branchId],
      ['refund-summary', branchId],
      ['closing', branchId],
      ['reconciliation', branchId],
      ['home', branchId],
      ['dashboard', branchId],
      ['inventory-value', branchId],
      [...qk.notifications],
    ]) {
      void qc.invalidateQueries({ queryKey: prefix as readonly unknown[] });
    }
  };
}

export interface CreateReturnBody {
  saleItemId: string;
  identifier: string;
  requestReason: string;
  conditionNotes?: string;
  custody: 'customer_holds' | 'store_holds';
  clientUuid: string;
}

/**
 * Raise a return.
 *
 * `clientUuid` is generated once per logical request by the caller and reused
 * across retries, so a flaky connection cannot create two claims. The server
 * answers a replay with the original request; a replay carrying DIFFERENT
 * content is a 409, which is a real conflict rather than something to retry.
 */
export function useCreateReturn() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: CreateReturnBody) => api.post<ReturnDetail>('/returns', body),
    onSuccess: refresh,
  });
}

export function useReceiveCustody(id: string) {
  const refresh = useRefresh(id);
  return useMutation({
    mutationFn: (body: { identifier: string; expectedVersion: number }) =>
      api.post<ReturnDetail>(`/returns/${id}/custody`, body),
    onSuccess: refresh,
  });
}

export function useInvestigate(id: string) {
  const refresh = useRefresh(id);
  return useMutation({
    mutationFn: (body: {
      expectedVersion: number;
      responsibility?: ReturnResponsibility;
      responsibilityNotes?: string;
      conditionNotes?: string;
    }) => api.patch<ReturnDetail>(`/returns/${id}/investigation`, body),
    onSuccess: refresh,
  });
}

export function useAddAdjustment(id: string) {
  const refresh = useRefresh(id);
  return useMutation({
    mutationFn: (body: {
      kind: ReturnAdjustmentKind;
      label: string;
      quantity: number;
      unitAmount: number;
      expectedVersion: number;
    }) => api.post<ReturnDetail>(`/returns/${id}/adjustments`, body),
    onSuccess: refresh,
  });
}

export function useRemoveAdjustment(id: string) {
  const refresh = useRefresh(id);
  return useMutation({
    mutationFn: (args: { adjustmentId: string; expectedVersion: number }) =>
      api.delete<ReturnDetail>(
        `/returns/${id}/adjustments/${args.adjustmentId}?expectedVersion=${args.expectedVersion}`,
      ),
    onSuccess: refresh,
  });
}

export function useApproveReturn(id: string) {
  const refresh = useRefresh(id);
  return useMutation({
    mutationFn: (body: { expectedVersion: number; exceptionReason?: string }) =>
      api.post<ReturnDetail>(`/returns/${id}/approve`, body),
    onSuccess: refresh,
  });
}

export function useRejectReturn(id: string) {
  const refresh = useRefresh(id);
  return useMutation({
    mutationFn: (body: { expectedVersion: number; reason: string }) =>
      api.post<ReturnDetail>(`/returns/${id}/reject`, body),
    onSuccess: refresh,
  });
}

/**
 * Two people decided at once, and this device lost.
 *
 * The answer is never to retry: the other decision is already final and
 * retrying would be attempting to overturn it. Refresh, and show what actually
 * happened.
 */
export function isStaleConflict(e: unknown): boolean {
  return e instanceof ApiError && e.status === 409;
}

export function handleConflict(e: unknown, refetch: () => void): boolean {
  if (!isStaleConflict(e)) return false;
  toast.info(t('returns.conflict'), { description: t('returns.conflictBody') });
  refetch();
  return true;
}

// ───────────────────────────── refund payout (I3) ─────────────────────────────

export interface ReportRefundBody {
  /** Locked to the immutable net refund due; the form displays, never edits it. */
  reportedAmount: number;
  method: RefundMethod;
  /** Required for `account`, forbidden for `cash` — the server enforces both. */
  receivingAccountId?: string;
  transactionReference?: string;
  note?: string;
  /** One per logical report, reused across retries. */
  clientUuid: string;
}

/**
 * Report that the refund was handed over.
 *
 * A CLAIM, not the record: it creates no cash movement and settles nothing
 * until a Manager or Owner confirms. `clientUuid` is minted once per attempt by
 * the caller and reused for every retry, so a timeout cannot record two
 * payouts — the server answers a replay with the original.
 */
export function useReportRefund(id: string) {
  const refresh = useRefundRefresh(id);
  return useMutation({
    mutationFn: (body: ReportRefundBody) =>
      api.post<ReturnDetail>(`/returns/${id}/refund/report`, body),
    onSuccess: refresh,
  });
}

export interface CorrectRefundBody {
  /** The PAYOUT version, not the return version. */
  expectedVersion: number;
  method?: RefundMethod;
  receivingAccountId?: string;
  transactionReference?: string;
  note?: string;
}

/**
 * Fix how a reported refund was paid, before confirming it.
 *
 * The amount is never here: it is the immutable net refund due, and a payout
 * that does not match it is not a correction but a different obligation.
 */
export function useCorrectRefund(id: string) {
  const refresh = useRefundRefresh(id);
  return useMutation({
    mutationFn: (body: CorrectRefundBody) =>
      api.patch<ReturnDetail>(`/returns/${id}/refund`, body),
    onSuccess: refresh,
  });
}

/**
 * Confirm the refund was paid. This is the authoritative record.
 *
 * Deliberately no optimistic update: marking it confirmed before the server
 * agrees is how two people both believe they signed off the same payment.
 */
export function useConfirmRefund(id: string) {
  const refresh = useRefundRefresh(id);
  return useMutation({
    mutationFn: (body: { expectedVersion: number }) =>
      api.post<ReturnDetail>(`/returns/${id}/refund/confirm`, body),
    onSuccess: refresh,
  });
}

/**
 * The confirmed receipt.
 *
 * Fetched on demand rather than with the detail: it exists only once confirmed,
 * and asking earlier is a 409 the screen would have to swallow on every render.
 */
export function useRefundReceipt(id: string, enabled: boolean) {
  const branchId = useBranch((s) => s.branchId);
  return useQuery({
    queryKey: qk.refundReceipt(branchId, id),
    enabled: enabled && Boolean(id),
    retry: false,
    queryFn: () => api.get<RefundReceipt>(`/returns/${id}/refund/receipt`),
  });
}

/** Outstanding liability and settled refunds for the active branch. */
export function useRefundSummary(range?: { from?: string; to?: string }) {
  const branchId = useBranch((s) => s.branchId);
  const p = new URLSearchParams();
  if (range?.from) p.set('from', range.from);
  if (range?.to) p.set('to', range.to);
  const qs = p.toString();
  return useQuery({
    queryKey: qk.refundSummary(branchId, qs),
    enabled: Boolean(branchId),
    queryFn: () => api.get<RefundSummary>(`/returns/refunds/summary${qs ? `?${qs}` : ''}`),
  });
}

/**
 * A refund conflict, told apart so the screen can say which one happened.
 *
 * They need different words: a stale version means somebody else acted, an
 * already-confirmed replay means the work is done, and a locked day means the
 * books are closed and reopening them is not this screen's decision.
 */
export type RefundConflict = 'stale' | 'already_confirmed' | 'day_locked' | 'not_confirmed' | 'other';

export function refundConflictKind(e: unknown): RefundConflict | null {
  if (!(e instanceof ApiError) || e.status !== 409) return null;
  const code = (e.body as { code?: string } | undefined)?.code ?? '';
  if (code === 'refresh_required' || code === 'stale_version') return 'stale';
  if (code === 'already_confirmed') return 'already_confirmed';
  if (code === 'day_locked' || code === 'closing_locked') return 'day_locked';
  if (code === 'not_confirmed') return 'not_confirmed';
  return 'other';
}
