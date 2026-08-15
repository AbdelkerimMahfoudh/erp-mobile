import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from './api-client';
import { useBranch } from './branch';
import { qk } from './query-keys';
import type {
  Supplier,
  SupplierDetail,
  SupplierPage,
  SupplierPayable,
  SupplierSettlement,
} from '../types/api';

/**
 * The mobile side of suppliers and what the shop owes them.
 *
 * **The server owns the money.** Nothing here computes an outstanding balance,
 * decides an allocation or marks a payment settled — the ledger is derived
 * server-side from immutable rows, and this file renders that answer. The app's
 * jobs are asking the right question, sending the version it last saw, and
 * refreshing exactly what a payment changed.
 */

export interface SupplierFilters {
  search?: string;
  status?: 'active' | 'inactive' | 'all';
}

function queryString(f: SupplierFilters): string {
  const p = new URLSearchParams();
  if (f.search?.trim()) p.set('search', f.search.trim());
  if (f.status) p.set('status', f.status);
  return p.toString();
}

/**
 * The supplier list, paged by the server.
 *
 * Search and status live in the query key as well as the request: a cursor
 * issued under one query means nothing under another.
 */
export function useSuppliers(filters: SupplierFilters) {
  const branchId = useBranch((s) => s.branchId);
  const qs = queryString(filters);
  return useInfiniteQuery({
    queryKey: [...qk.suppliers, branchId, qs],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams(qs);
      if (pageParam) p.set('cursor', pageParam);
      const suffix = p.toString();
      return api.get<SupplierPage>(`/suppliers${suffix ? `?${suffix}` : ''}`);
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** Active suppliers only — what the Receive picker must offer. */
export function useActiveSuppliers() {
  return useQuery({
    queryKey: [...qk.suppliers, 'active'],
    queryFn: () => api.get<SupplierPage>('/suppliers?status=active&limit=50'),
  });
}

export function useSupplier(id: string | undefined) {
  return useQuery({
    queryKey: qk.supplier(id ?? ''),
    enabled: Boolean(id),
    // A supplier that does not exist is an answer, not a fault.
    retry: false,
    queryFn: () => api.get<SupplierDetail>(`/suppliers/${id}`),
  });
}

/** Open purchases, with the server's suggested oldest-first split of `amount`. */
export function useSupplierPayable(id: string | undefined, amount?: number) {
  return useQuery({
    queryKey: qk.supplierPayable(id ?? '', amount),
    enabled: Boolean(id),
    queryFn: () =>
      api.get<SupplierPayable>(
        `/suppliers/${id}/payable${amount && amount > 0 ? `?amount=${amount}` : ''}`,
      ),
  });
}

/**
 * What a supplier write changes.
 *
 * A confirmed payment moves cash on the day it happens, so the closing and
 * reconciliation figures stop being true the moment it lands. Prefixes, not
 * exact keys — each of these is keyed by branch and often by a date.
 */
function useSupplierRefresh(id?: string) {
  const qc = useQueryClient();
  const branchId = useBranch((s) => s.branchId);
  return () => {
    if (id) {
      void qc.invalidateQueries({ queryKey: qk.supplier(id) });
      void qc.invalidateQueries({ queryKey: ['supplier-payable', id] });
    }
    for (const prefix of [
      [...qk.suppliers],
      ['closing', branchId],
      ['reconciliation', branchId],
      ['home', branchId],
      ['dashboard', branchId],
      [...qk.notifications],
    ]) {
      void qc.invalidateQueries({ queryKey: prefix as readonly unknown[] });
    }
  };
}

export interface SupplierBody {
  name: string;
  phone?: string;
  notes?: string;
}

export function useCreateSupplier() {
  const refresh = useSupplierRefresh();
  return useMutation({
    mutationFn: (body: SupplierBody) => api.post<SupplierDetail>('/suppliers', body),
    onSuccess: refresh,
  });
}

export function useUpdateSupplier(id: string) {
  const refresh = useSupplierRefresh(id);
  return useMutation({
    mutationFn: (body: Partial<SupplierBody> & { isActive?: boolean }) =>
      api.patch<SupplierDetail>(`/suppliers/${id}`, body),
    onSuccess: refresh,
  });
}

export interface ReportPaymentBody {
  supplierId: string;
  amount: number;
  method: 'cash' | 'account';
  receivingAccountId?: string;
  allocations: { purchaseId: string; amount: number }[];
  transactionReference?: string;
  note?: string;
  /** One per logical report, reused across retries. */
  clientUuid: string;
}

/**
 * Report that a supplier was paid.
 *
 * A CLAIM: it moves no money and settles nothing until a manager or owner
 * confirms. The allocation is always explicit and comes back in the response,
 * so the person can see where the money went.
 */
export function useReportPayment(supplierId: string) {
  const refresh = useSupplierRefresh(supplierId);
  return useMutation({
    mutationFn: (body: ReportPaymentBody) =>
      api.post<SupplierSettlement>('/suppliers/payments', body),
    onSuccess: refresh,
  });
}

export function useCorrectPayment(supplierId: string) {
  const refresh = useSupplierRefresh(supplierId);
  return useMutation({
    mutationFn: ({
      settlementId,
      ...body
    }: {
      settlementId: string;
      expectedVersion: number;
      method?: 'cash' | 'account';
      receivingAccountId?: string;
      transactionReference?: string;
      note?: string;
    }) => api.patch<SupplierSettlement>(`/suppliers/payments/${settlementId}`, body),
    onSuccess: refresh,
  });
}

/**
 * Confirm the payment. The authoritative record.
 *
 * No optimistic update: marking it confirmed before the server agrees is how
 * two people both believe they signed off the same money.
 */
export function useConfirmPayment(supplierId: string) {
  const refresh = useSupplierRefresh(supplierId);
  return useMutation({
    mutationFn: ({ settlementId, expectedVersion }: { settlementId: string; expectedVersion: number }) =>
      api.post<SupplierSettlement>(`/suppliers/payments/${settlementId}/confirm`, { expectedVersion }),
    onSuccess: refresh,
  });
}

/**
 * A supplier conflict, told apart so the screen can say which one happened.
 *
 * They need different words: somebody acted first, the money is already
 * confirmed, the books are closed, the supplier is retired, or the account is.
 */
export type SupplierConflict =
  | 'stale'
  | 'already_confirmed'
  | 'day_locked'
  | 'supplier_inactive'
  | 'account_inactive'
  | 'duplicate'
  | 'other';

export function supplierConflictKind(e: unknown): SupplierConflict | null {
  if (!(e instanceof ApiError) || e.status !== 409) return null;
  const code = (e.body as { code?: string } | undefined)?.code ?? '';
  if (code === 'refresh_required') return 'stale';
  if (code === 'already_confirmed') return 'already_confirmed';
  if (code === 'day_locked') return 'day_locked';
  if (code === 'supplier_inactive') return 'supplier_inactive';
  if (code === 'account_inactive') return 'account_inactive';
  if (code === 'supplier_exists') return 'duplicate';
  return 'other';
}

/**
 * Per-line refusals from a payment, as themselves.
 *
 * "That payment cannot be applied" is not actionable; "only 40 left on that
 * purchase" is.
 */
export function paymentProblems(e: unknown): { label: string; reason: string }[] {
  if (!(e instanceof ApiError)) return [];
  const body = e.body as
    | { problems?: { purchaseId?: string; reason?: string; outstanding?: number; requested?: number }[] }
    | undefined;
  if (!Array.isArray(body?.problems)) return [];
  return body.problems
    .map((p) => {
      const label = p.purchaseId ? p.purchaseId.slice(0, 8).toUpperCase() : '';
      const reason =
        p.outstanding !== undefined && p.requested !== undefined
          ? `${p.requested} > ${p.outstanding}`
          : (p.reason ?? '');
      return label && reason ? { label, reason } : null;
    })
    .filter((p): p is { label: string; reason: string } => p !== null);
}

export type { Supplier };
