import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api-client';
import { useBranch } from './branch';
import { qk } from './query-keys';

/**
 * Customers, as the till needs them (4a).
 *
 * Deliberately two operations. A sale may name a customer, and a credit or
 * partial sale must — but an ordinary cash sale needs nobody, and this module
 * exists so the cashier can attribute a sale, not to manage a CRM.
 *
 * The server decides who may do what: finding is part of `sale.create`, adding
 * is `customer.manage`. Nothing here infers either.
 */

export interface Customer {
  id: string;
  name: string | null;
  phone: string | null;
  /** What they still owe, maintained by the sale flow. */
  balance: number;
}

/**
 * Search by name or phone.
 *
 * Gated on the branch being restored for the same reason every other detail
 * query is: the server resolves permissions from `X-Branch-Id`, and asking
 * before it exists is a 403 the screen would have to explain away.
 */
export function useCustomers(search: string, enabled = true) {
  const branchId = useBranch((s) => s.branchId);
  const term = search.trim();
  return useQuery({
    queryKey: qk.customers(term),
    queryFn: () => api.get<{ rows: Customer[]; nextCursor: string | null }>(
      `/customers${term ? `?search=${encodeURIComponent(term)}` : ''}`,
    ),
    enabled: enabled && Boolean(branchId),
  });
}

export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; phone?: string }) => api.post<Customer>('/customers', body),
    onSuccess: () => {
      // Every search is now potentially stale — the new customer must appear.
      void qc.invalidateQueries({ queryKey: qk.customersAll });
    },
  });
}
