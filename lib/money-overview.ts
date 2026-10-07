import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';
import { api } from './api-client';
import { useBranch } from './branch';
import { invalidateMoney } from './money-invalidation';
import { checkMoneyOverview, checkSalesByDay, retryUnlessIncompatible } from './contract';
import { qk } from './query-keys';
import { isStoreClosedRefusal } from './day-gate';
import { payerNumberField } from './payer-number';
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

/** One method's money today: recorded in, recorded out, and the difference (2026-09-27). */
export interface MethodMoney {
  channel: 'cash' | 'account';
  accountId: string | null;
  /** `CASH` / `UNATTRIBUTED` sentinels, or the account's label. */
  label: string;
  isUnattributed: boolean;
  moneyIn: number;
  moneyOut: number;
  net: number;
}

/**
 * What one method holds as this app tracks it: an amount known to be true at one moment (the anchor) plus everything
 * recorded since, carried across midnight (2026-09-27). Never a provider's balance.
 */
export interface TrackedMethod {
  /** `cash`, or `account:<uuid>`. */
  key: string;
  channel: 'cash' | 'account';
  accountId: string | null;
  /** The account's label; '' for cash, which the phone names in its own language. */
  label: string;
  /** The drawer is the branch's; an account is the company's, whichever branch moved it. */
  scope: 'branch' | 'company';
  isActive: boolean;
  known: boolean;
  /** Null when the records cannot establish it — never 0. */
  position: number | null;
  unknownReason: 'no_counted_close' | 'no_anchor' | null;
  anchor: {
    /**
     * Cash starts from a counted close, or from the amount a shop opened with (docs/63); an account from the amount
     * the Owner read off its app.
     */
    source: 'counted_close' | 'declared' | 'opening';
    amount: number;
    at: string | null;
    businessDate: string;
    byName: string | null;
    /** An opening's decision: kept or set by the Owner, or carried by somebody else who opened. */
    decision?: 'keep' | 'set' | 'carried';
    /** A carried amount the Owner has not reviewed: shown as awaiting the Owner, never as checked. */
    awaitingOwnerReview?: boolean;
  } | null;
  sinceAnchorNet: number | null;
  /**
   * What moved through the method on the current business day — inflows, confirmed outflows and the net — whatever
   * the position (2026-10-07): an unknown opening never becomes a balance, but the recorded money is not hidden. The
   * drawer's day is this branch's; an account's is every shop's. Absent on an older server.
   */
  movement?: { businessDate: string; inflows: number; outflows: number; net: number };
}

export interface TrackedMoney {
  asOf: string;
  businessDate: string;
  basis: 'anchor_plus_recorded_movement';
  /** The company's stores: an account's figure covers all of them. */
  branchCount: number;
  /**
   * Whether the accounts are listed. Their amounts are the company's, so only the Owner, who may set them, sees them;
   * anyone else gets this branch's drawer alone, and no total.
   */
  accountsVisible: boolean;
  /** Cash first, then the active accounts in the shop's order, then a switched-off account that has an anchor. */
  methods: TrackedMethod[];
  /** The server's sum of the positions, only when the accounts are listed and every method is known — never a total over a gap. */
  total: number | null;
  unknownKeys: string[];
}

export interface ExpenseToday {
  /** `reversal`: part of an expense reversed today — its amount is negative (docs/53). */
  kind?: 'expense' | 'reversal';
  id: string;
  /** The expense the row opens (for a reversal, the expense it corrected). */
  expenseId?: string | null;
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
  /** Cash the drawer should hold now — the closing's own expected figure (the expense screens' estimate). */
  cashNow: number;
  /**
   * Every configured method on one basis: money in less money out recorded on the current business day, no opening
   * for any of them; `total` is the server's sum of exactly these rows. Not a drawer count, not a provider balance.
   */
  moneyToday: { channels: MethodMoney[]; total: { moneyIn: number; moneyOut: number; net: number } };
  /** What each method holds, as tracked — a position, never mixed with today's movement above. */
  trackedMoney: TrackedMoney;
  period: {
    phonesSold: number;
    /** Every item on the invoices less items on cancelled invoices — what "Items sold" shows (docs/53 R6). */
    unitsSold: number;
    /** Invoices less whole-sale cancellations (R5). */
    salesCount: number;
    cancellations: { count: number; value: number; phones: number };
    returns: { count: number; value: number; phones: number };
    /** cancellations + returns, from the server. */
    adjusted: number;
    netSalesValue: number;
    /** The full selling price of everything sold. Not money received. */
    salesValue: number;
    /** Money actually received in the period, dated by when it arrived. */
    collected: number;
    /** Still owed on the sales made in the period. */
    outstanding: number;
    refunds: number;
  };
  outstandingAll: { amount: number; sales: number };
  /** `total` = recorded − reversed; the rows add up to it. */
  expensesToday: { total: number; recorded: number; reversed: number; rows: ExpenseToday[] };
}

export function useMoneyOverview(from: string, to: string, opts: { enabled?: boolean } = {}) {
  const branchId = useBranch((s) => s.branchId);
  return useQuery({
    queryKey: qk.moneyOverview(branchId, from, to),
    enabled: (opts.enabled ?? true) && Boolean(branchId),
    // A reply missing a figure is refused whole, never shown as zero (docs/54).
    queryFn: async () => checkMoneyOverview(await api.get<MoneyOverview>(`/closings/overview?from=${from}&to=${to}`)),
    retry: retryUnlessIncompatible,
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
  /** Invoices less whole-sale cancellations approved that day (docs/53 R5). */
  sales: number;
  phones: number;
  /** Items on the day's invoices less items on sales cancelled that day (R6). */
  units: number;
  /** The day's invoices. */
  value: number;
  /** Cancellations and returns approved that day, whatever day their sale was. */
  cancelled: number;
  returned: number;
  returns: number;
  /** cancelled + returned, from the server. */
  adjusted: number;
  /** value − returned − cancelled — negative on a day holding only an adjustment. */
  net: number;
  outstanding: number;
}

export function useSalesByDay(from: string, to: string, opts: { enabled?: boolean } = {}) {
  const branchId = useBranch((s) => s.branchId);
  return useQuery({
    queryKey: qk.salesByDay(branchId, from, to),
    enabled: (opts.enabled ?? true) && Boolean(branchId),
    queryFn: async () => checkSalesByDay(await api.get<{ from: string; to: string; days: SalesDay[] }>(`/sales/by-day?from=${from}&to=${to}`)),
    retry: retryUnlessIncompatible,
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
  /** The number the money came from, as typed (D151); sent normalised, and only for money that is not cash. */
  payerNumber: string;
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
        ...payerNumberField(input.method, input.payerNumber),
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
    onError: (e) => {
      // The store closed under this payment: the day is read again, so Home and the counter show the lock too.
      if (isStoreClosedRefusal(e)) {
        void qc.invalidateQueries({ queryKey: qk.businessDay(branchId) });
        void qc.invalidateQueries({ queryKey: qk.home(branchId) });
      }
    },
  });

  return mutation;
}

// ── what an account holds ───────────────────────────────────────────────────

export interface RecordAnchorInput {
  accountId: string;
  amount: number;
  note: string;
}

export interface RecordedAnchor {
  anchor: {
    id: string;
    accountId: string;
    label: string;
    amount: number;
    at: string;
    businessDate: string;
    trackedBefore: number | null;
    difference: number | null;
    note: string | null;
    byName: string | null;
  };
  /** The account's line of the card, worked out again after the save. */
  method: TrackedMethod;
}

/**
 * The Owner saying what an account holds now, read off the account's own app (0082).
 *
 * **One key per amount sent, within one opening of the sheet.** A retry of the
 * same account, amount and note keeps its key, so "Save" again after a timeout
 * is the same anchor, not a second one taken later; a changed amount is a new
 * anchor with a new key, never a refused conflict. The sheet calls `reset()` as
 * it opens and closes, so the same amount saved another time is a new anchor,
 * never the replay of one whose answer was lost earlier. Once saved, the next
 * amount always gets a fresh key.
 */
export function useRecordMoneyAnchor() {
  const qc = useQueryClient();
  const attempt = useRef<{ clientUuid: string; payload: string } | null>(null);

  const mutation = useMutation({
    mutationFn: ({ accountId, amount, note }: RecordAnchorInput) => {
      const payload = { accountId, amount, ...(note.trim() ? { note: note.trim() } : {}) };
      const sent = JSON.stringify(payload);
      if (attempt.current?.payload !== sent) attempt.current = { clientUuid: uuidv4(), payload: sent };
      return api.post<RecordedAnchor>('/money/anchors', { clientUuid: attempt.current.clientUuid, ...payload });
    },
    onSuccess: () => {
      attempt.current = null;
    },
    // The top card, on every Money read that carries it — after a failure too: a lost answer may still have saved it.
    onSettled: () => invalidateMoney(qc),
  });
  const { reset: resetMutation } = mutation;
  // A new attempt: a fresh key for whatever it saves, and nothing left showing from the last one.
  const reset = useCallback(() => {
    attempt.current = null;
    resetMutation();
  }, [resetMutation]);
  return { ...mutation, reset };
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
