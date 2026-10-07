import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api-client';
import { useBranch } from './branch';
import { qk } from './query-keys';
import type { PaymentMethod, SaleDetail, SalePage, SalePayStatus, SalePaymentState } from '../types/api';

/**
 * The mobile side of sale history.
 *
 * **Every filter goes to the server.** Nothing here narrows a loaded page: a
 * screen that searched only what it had already fetched would answer "nothing
 * matches" for a sale two pages down, and someone is usually standing at the
 * counter holding the receipt for exactly that sale.
 */

export interface SaleFilters {
  search?: string;
  payStatus?: SalePayStatus[];
  paymentMethod?: PaymentMethod[];
  /** Inclusive dates, `YYYY-MM-DD`. A bare date means the whole of that day. */
  from?: string;
  to?: string;
}

export function saleQueryString(filters: SaleFilters): string {
  const p = new URLSearchParams();
  if (filters.search?.trim()) p.set('search', filters.search.trim());
  if (filters.payStatus?.length) p.set('payStatus', filters.payStatus.join(','));
  if (filters.paymentMethod?.length) p.set('paymentMethod', filters.paymentMethod.join(','));
  if (filters.from) p.set('from', filters.from);
  if (filters.to) p.set('to', filters.to);
  return p.toString();
}

/**
 * The sale list, paged by the server.
 *
 * The filters live in the query key as well as in the request: a cursor issued
 * under one query is meaningless under another, so changing a filter must start
 * a fresh run rather than continue the previous one.
 */
export function useSales(filters: SaleFilters, opts: { enabled?: boolean } = {}) {
  const branchId = useBranch((s) => s.branchId);
  const qs = saleQueryString(filters);

  return useInfiniteQuery({
    queryKey: qk.sales(branchId, qs),
    enabled: opts.enabled ?? true,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams(qs);
      if (pageParam) p.set('cursor', pageParam);
      const suffix = p.toString();
      return api.get<SalePage>(`/sales${suffix ? `?${suffix}` : ''}`);
    },
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useSale(id: string | undefined) {
  return useQuery({
    queryKey: qk.sale(id ?? ''),
    enabled: Boolean(id),
    queryFn: () => api.get<SaleDetail>(`/sales/${id}`),
  });
}

/**
 * Correct the number a non-cash payment came from (D151). It moves no money —
 * the amount, account and day stay as recorded — and the server audits the
 * change. Owner and Store Manager (`financial.correction.request`).
 */
export function useCorrectPayerNumber(saleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { paymentId: string; payerNumber: string | null; reason: string }) =>
      api.post<SalePaymentState>(`/sales/${saleId}/payments/${input.paymentId}/payer-number`, {
        payerNumber: input.payerNumber,
        ...(input.reason.trim() ? { reason: input.reason.trim() } : {}),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.sale(saleId) });
    },
  });
}

/**
 * The shop's default return window, as the server reports it.
 *
 * `GET /settings` narrows itself to what the caller may see, and the window is
 * in the employee view — the person at the till has to be able to state the
 * policy. Defaults to "no returns" while it loads, so a slow network can never
 * make the screen offer a promise the shop has not made.
 */
export function useCompanyReturnWindow(): number {
  const query = useQuery({
    queryKey: qk.settings,
    queryFn: () => api.get<{ returnWindowHours: number }>('/settings'),
  });
  return query.data?.returnWindowHours ?? 0;
}
