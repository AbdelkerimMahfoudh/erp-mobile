import { useInfiniteQuery } from '@tanstack/react-query';
import { api, ApiError } from './api-client';
import { useBranch } from './branch';
import { qk } from './query-keys';
import { lookupFailure, normalizeImeiInput, type LookupFailure } from './phone-selection-rules';
import type { InventoryPage, InventoryUnitRow, SaleSelection } from '../types/api';

export * from './phone-selection-rules';

/**
 * Ask the server about the phone behind an identifier — the ONE lookup every
 * way of finding a phone ends in. Returns the selection, or why there is none.
 */
export async function lookupSelection(
  raw: string,
): Promise<{ ok: true; selection: SaleSelection; identifier: string } | { ok: false; failure: LookupFailure }> {
  const identifier = normalizeImeiInput(raw);
  try {
    const selection = await api.get<SaleSelection>(`/sales/selection/${encodeURIComponent(identifier)}`);
    return { ok: true, selection, identifier };
  } catch (e) {
    const status = e instanceof ApiError ? e.status : null;
    const code = e instanceof ApiError ? ((e.body as { code?: string } | undefined)?.code ?? e.code ?? null) : null;
    return { ok: false, failure: lookupFailure(status, code) };
  }
}

/**
 * Phones on the shelf at this branch, searchable by model or either IMEI — the
 * same paged `GET /inventory` the Stock screen reads, limited to what is in
 * stock and to serialized units: a charger is not a phone to pick.
 */
export function useStockPhones(search: string, enabled: boolean) {
  const branchId = useBranch((s) => s.branchId);
  const term = search.trim();
  const query = useInfiniteQuery({
    queryKey: qk.inventory(branchId, 'in_stock', term, 'pick'),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: '30', status: 'in_stock' });
      if (term) params.set('search', term);
      if (pageParam) params.set('cursor', pageParam);
      return api.get<InventoryPage>(`/inventory?${params.toString()}`);
    },
    getNextPageParam: (last) => last.nextCursor,
    enabled: enabled && Boolean(branchId),
  });
  const phones = (query.data?.pages.flatMap((p) => p.rows) ?? []).filter(
    (r): r is InventoryUnitRow => r.kind === 'unit',
  );
  return { ...query, phones };
}
