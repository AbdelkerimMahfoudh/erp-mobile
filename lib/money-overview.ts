import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { api } from './api-client';
import { useBranch } from './branch';
import { invalidateMoney } from './money-invalidation';
import { qk } from './query-keys';
import { uuidv4 } from './utils';
import type { DebtorKind, PaymentMethod, SalePayStatus, SalePaymentState } from '../types/api';

/**
 * Money, as the server counts it (0074).
 *
 * Every figure below is computed by the server. The phone chooses words and
 * layout, never an amount: "cash in the drawer" and "collected this week" are
 * the shop's money, and a figure the phone worked out itself is one that can
 * quietly disagree with the closing.
 */

export interface AccountToday {
  accountId: string | null;
  label: string | null;
  isUnattributed: boolean;
  moneyIn: number;
  moneyOut: number;
  net: number;
}

export interface ExpenseToday {
  id: string;
  description: string;
  amount: number;
  method: 'cash' | 'account';
  accountLabel: string | null;
  reference: string | null;
  hasReceipt: boolean;
  paidAt: string | null;
}

export interface MoneyOverview {
  from: string;
  to: string;
  today: string;
  /** Cash the drawer should hold now — the closing's own expected figure. */
  cashNow: number;
  /** What moved through each account today. Deliberately not a balance. */
  accountsToday: AccountToday[];
  period: {
    phonesSold: number;
    salesCount: number;
    /** The full selling price of everything sold. Not money received. */
    salesValue: number;
    /** Money actually received in the period, dated by when it arrived. */
    collected: number;
    /** Still owed on the sales made in the period. */
    outstanding: number;
    refunds: number;
  };
  outstandingAll: { amount: number; sales: number };
  expensesToday: { total: number; rows: ExpenseToday[] };
}

export function useMoneyOverview(from: string, to: string, opts: { enabled?: boolean } = {}) {
  const branchId = useBranch((s) => s.branchId);
  return useQuery({
    queryKey: qk.moneyOverview(branchId, from, to),
    enabled: (opts.enabled ?? true) && Boolean(branchId),
    queryFn: () => api.get<MoneyOverview>(`/closings/overview?from=${from}&to=${to}`),
  });
}

// ── outstanding balances ────────────────────────────────────────────────────

export interface OutstandingSale {
  id: string;
  invoiceNo: string;
  soldAt: string;
  product: string | null;
  total: number;
  received: number;
  remaining: number;
  payStatus: SalePayStatus;
}

export interface OutstandingDebtor {
  kind: DebtorKind;
  id: string | null;
  name: string | null;
  phone: string | null;
  owed: number;
  oldest: string;
  sales: OutstandingSale[];
}

export interface Outstanding {
  total: number;
  sales: number;
  debtors: OutstandingDebtor[];
}

export function useOutstanding(opts: { enabled?: boolean } = {}) {
  const branchId = useBranch((s) => s.branchId);
  return useQuery({
    queryKey: qk.outstanding(branchId),
    enabled: (opts.enabled ?? true) && Boolean(branchId),
    queryFn: () => api.get<Outstanding>('/sales/outstanding'),
  });
}

// ── sales by day ────────────────────────────────────────────────────────────

export interface SalesDay {
  day: string;
  sales: number;
  phones: number;
  value: number;
  outstanding: number;
}

export function useSalesByDay(from: string, to: string, opts: { enabled?: boolean } = {}) {
  const branchId = useBranch((s) => s.branchId);
  return useQuery({
    queryKey: qk.salesByDay(branchId, from, to),
    enabled: (opts.enabled ?? true) && Boolean(branchId),
    queryFn: () => api.get<{ from: string; to: string; days: SalesDay[] }>(`/sales/by-day?from=${from}&to=${to}`),
  });
}

// ── recording a later payment ───────────────────────────────────────────────

export interface RecordPaymentInput {
  amount: number;
  method: PaymentMethod;
  receivingAccountId: string | null;
  paidAt: string | null;
  reference: string;
  note: string;
}

/**
 * Record money received later against a sale.
 *
 * **One key for the whole attempt.** It is created when the screen opens and
 * reused on every retry, so a timeout followed by "Try again" is the same
 * payment, not a second one. The server binds the key to what was sent: a
 * retry with the same details answers the same, and changed details are
 * refused — so the key is renewed only once a payment has actually succeeded.
 */
export function useRecordSalePayment(saleId: string) {
  const qc = useQueryClient();
  const branchId = useBranch((s) => s.branchId);
  const key = useRef(uuidv4());

  const mutation = useMutation({
    mutationFn: (input: RecordPaymentInput) =>
      api.post<SalePaymentState>(`/sales/${saleId}/payments`, {
        clientUuid: key.current,
        amount: input.amount,
        method: input.method,
        ...(input.method !== 'cash' && input.receivingAccountId ? { receivingAccountId: input.receivingAccountId } : {}),
        ...(input.paidAt ? { paidAt: input.paidAt } : {}),
        ...(input.reference.trim() ? { reference: input.reference.trim() } : {}),
        ...(input.note.trim() ? { note: input.note.trim() } : {}),
      }),
    onSuccess: () => {
      key.current = uuidv4();
      void qc.invalidateQueries({ queryKey: qk.sale(saleId) });
      void qc.invalidateQueries({ queryKey: ['sales'] });
      void qc.invalidateQueries({ queryKey: qk.home(branchId) });
      void qc.invalidateQueries({ queryKey: ['open-closing'] });
      // Cash, the chosen account, the overview, collected and outstanding.
      invalidateMoney(qc);
    },
  });

  return mutation;
}

// ── where new money may arrive ──────────────────────────────────────────────

export interface SelectableAccount {
  id: string;
  label: string;
  provider: string;
  providerName?: string | null;
  isActive?: boolean;
}

/**
 * The accounts new money may be recorded into: active ones only. The same
 * `/settings` read the till uses, filtered the same way; the server refuses an
 * inactive account whatever the screen offers.
 */
export function useSelectableAccounts() {
  const query = useQuery({
    queryKey: qk.settings,
    queryFn: () => api.get<{ receivingAccounts?: SelectableAccount[] }>('/settings'),
  });
  return { ...query, accounts: (query.data?.receivingAccounts ?? []).filter((a) => a.isActive !== false) };
}
