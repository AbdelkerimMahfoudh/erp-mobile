import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api-client';
import { useBranch } from './branch';
import { qk } from './query-keys';
import type {
  CorrectionPage,
  FinancialCorrection,
  FinancialCorrectionKind,
} from '../types/api';

/**
 * Correcting a confirmed payment (Milestone B).
 *
 * Two authorities, and the screens must keep them apart: a Manager may ASK,
 * only an Owner may approve. Requesting moves no money at all — it records that
 * somebody believes a confirmed payment was wrong.
 */

export function useCorrections(status?: 'requested' | 'approved' | 'rejected') {
  const branchId = useBranch((s) => s.branchId);
  return useQuery({
    queryKey: qk.corrections(branchId, status ?? 'all'),
    queryFn: () =>
      api.get<CorrectionPage>(`/corrections${status ? `?status=${status}` : ''}`),
  });
}

export function useCorrection(id: string | undefined) {
  return useQuery({
    queryKey: qk.correction(id ?? ''),
    queryFn: () => api.get<FinancialCorrection>(`/corrections/${id}`),
    enabled: Boolean(id),
  });
}

interface RequestBody {
  targetKind: FinancialCorrectionKind;
  targetId: string;
  reason: string;
  supportingReference?: string;
  clientUuid: string;
}

/**
 * Ask for a correction.
 *
 * There is no amount here on purpose: the server copies it from the payment
 * being corrected, so a compensating movement cannot disagree with what was
 * actually paid.
 */
export function useRequestCorrection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RequestBody) => api.post<FinancialCorrection>('/corrections', body),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useApproveCorrection(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { expectedVersion: number }) =>
      api.post<FinancialCorrection>(`/corrections/${id}/approve`, body),
    // Approval restores a liability, so the return figures the user is about
    // to look at are stale.
    onSuccess: () => invalidateAll(qc),
  });
}

export function useRejectCorrection(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { expectedVersion: number; note?: string }) =>
      api.post<FinancialCorrection>(`/corrections/${id}/reject`, body),
    onSuccess: () => invalidateAll(qc),
  });
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  for (const key of ['corrections', 'correction', 'returns', 'return', 'refund-summary']) {
    void qc.invalidateQueries({ queryKey: [key] });
  }
}

export type CorrectionConflict =
  | 'stale'
  | 'already_decided'
  | 'already_corrected'
  | 'request_pending'
  | 'day_locked'
  | 'not_confirmed'
  | 'other';

/**
 * Turn a 409 into the sentence that actually explains it.
 *
 * Mirrors `refundConflictKind` deliberately, including reading
 * `day_already_closed` — the correction service reuses that exact code so this
 * needed no second branch.
 */
export function correctionConflictKind(e: unknown): CorrectionConflict | null {
  if (!(e instanceof ApiError) || e.status !== 409) return null;
  const code = (e.body as { code?: string } | undefined)?.code ?? '';
  if (code === 'refresh_required' || code === 'stale_version') return 'stale';
  if (code === 'already_decided') return 'already_decided';
  if (code === 'already_corrected') return 'already_corrected';
  if (code === 'request_pending') return 'request_pending';
  if (code === 'day_already_closed' || code === 'day_locked') return 'day_locked';
  if (code === 'not_confirmed') return 'not_confirmed';
  return 'other';
}
