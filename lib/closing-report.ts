import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api-client';
import { useBranch } from './branch';
import { qk } from './query-keys';
import { invalidateMoney } from './money-invalidation';
import type { DayStanding } from './home-day';
import type { CorrectionAction, Verification } from './closing-report-view';

/**
 * The Daily closing report (docs/51): what the boutique sold, where the money
 * went, the expenses and the result of one business date, built on the server
 * from the records the checkout and every other screen already wrote. Nothing
 * here is typed again and nothing is added up on the phone.
 *
 * A section the person may not see is ABSENT (`null`, or `status: 'hidden'`) —
 * the server leaves it out rather than the phone hiding it.
 */

export interface ReportChannel {
  key: string;
  channel: 'cash' | 'account';
  accountId: string | null;
  label: string;
  isUnattributed: boolean;
  countable: boolean;
  in: { todaysSales: number; olderDebts: number; correctionsIn: number; total: number };
  out: { refunds: number; stockPurchases: number; expenses: number; correctionsOut: number; total: number };
  net: number;
}

export interface ReportWarning {
  code: string;
  severity: 'info' | 'warning' | 'error';
  section: 'money' | 'sales' | 'expenses' | 'result' | 'day';
  params?: Record<string, string | number>;
}

export interface ReportResult {
  status: 'ok' | 'cannot_calculate';
  reason: 'cost_missing' | null;
  missingCostLines: number;
  netSales: number | null;
  costOfUnitsSold: number | null;
  returnsCostCredited: number | null;
  /** The recorded cost of the sales cancelled on this day, credited back (0079). */
  cancelledCostCredited: number | null;
  grossProfit: number | null;
  variableExpenses: number;
  fixedExpenses: number;
  resultBeforeFixed: number | null;
  resultAfterExpenses: number | null;
  scope: 'fixed_costs_on_due_date';
}

export interface DailyReport {
  date: string;
  today: string;
  isToday: boolean;
  timezone: string;
  window: { startsAt: string; endsAt: string };
  standing: DayStanding;
  sales: {
    count: number;
    value: number;
    itemsSold: number;
    /** Invoices − whole-sale cancellations approved on the date (docs/53 R5); absent on a close stored before it. */
    salesCount?: number;
    /** Units on the invoices − units on the cancelled invoices (R6). */
    unitsSold?: number;
    returns: { count: number; grossRefund: number; adjustments: number; netRefundDue: number };
    /** Sales cancelled on this day, whatever day they were sold (0079). */
    cancellations: { count: number; value: number; items: number };
    netSalesValue: number;
    /** `corrections`: what corrections took back from this day's sales (a payment never received, a cancelled sale's money). */
    collected: { atCheckout: number; laterSameDay: number; corrections: number; total: number };
    owed: number;
  } | null;
  money: {
    channels: ReportChannel[];
    totals: { in: number; out: number; net: number; todaysSales: number; olderDebts: number };
    pending: { refundReports: { count: number; amount: number }; expenseReports: { count: number; amount: number } } | null;
  };
  expenses: {
    /** Recorded − reversed. */
    total: number;
    recorded: number;
    /** Confirmed expenses reversed on this day (0079). */
    reversed: number;
    reversals: { correctionId: string; expenseId: string; category: string; expenseClass: 'variable' | 'fixed'; amount: number; method: 'cash' | 'account'; accountLabel: string | null }[];
    cash: number;
    account: number;
    count: number;
    variable: number;
    fixed: number;
    salaries: number;
    byCategory: { category: string; amount: number; count: number }[];
    lines: { id: string; category: string; expenseClass: 'variable' | 'fixed'; isSalary: boolean; amount: number; method: 'cash' | 'account'; accountLabel: string | null }[];
  } | null;
  result: ReportResult | { status: 'hidden' };
  expected: {
    cash: {
      opening: { amount: number; anchorDate: string | null; anchorVerified: boolean; carriedDays: number };
      in: number;
      out: number;
      expected: number;
      counted: number | null;
      difference: number | null;
      verification: Verification;
      countedAt: string | null;
    };
    accounts: {
      key: string;
      accountId: string | null;
      label: string;
      in: number;
      out: number;
      expectedMovement: number;
      counted: number | null;
      difference: number | null;
      verification: Verification;
      basis: 'recorded_movement_not_balance';
    }[];
  };
  warnings: ReportWarning[];
  close: { kind: 'first' | 'reclose' | 'already_locked'; requiresAcknowledgement: boolean; unverified: string[]; verified: string[]; canClose: boolean } | null;
  sections: { sales: boolean; expenses: boolean; result: boolean; close: boolean };
  reportVersion: string;
  liveVersion: string;
  source: 'live' | 'snapshot';
  snapshot: {
    kind: 'closed' | 'reclosed';
    at: string;
    by: string | null;
    verification: { verified: string[]; unverified: string[]; acknowledged: boolean; reason: string | null };
  } | null;
  generatedAt: string;
}

export function useDailyReport(date?: string) {
  const branchId = useBranch((s) => s.branchId);
  return useQuery({
    queryKey: qk.dailyReport(branchId, date ?? 'today'),
    queryFn: () => api.get<DailyReport>(`/closings/report${date ? `?date=${date}` : ''}`),
    // The day moves while it is open: never present a report that was not just read as final.
    staleTime: 0,
  });
}

export interface CloseDayBody {
  date: string;
  clientUuid: string;
  reportVersion: string;
  acknowledgeUnverified?: boolean;
  reason?: string;
}

export interface CloseDayResult {
  closingId: string;
  date: string;
  kind: 'first' | 'reclose';
  replayed: boolean;
  verification: { verified: string[]; unverified: string[]; acknowledged: boolean; reason: string | null };
  report: DailyReport;
}

/**
 * Close the business day on the report that was reviewed. The same `clientUuid`
 * on a retry replays the close instead of failing, and the `reportVersion` makes
 * the server refuse (409 `report_changed`) if the figures moved since.
 */
export function useCloseDay(date?: string) {
  const qc = useQueryClient();
  const branchId = useBranch((s) => s.branchId);
  return useMutation({
    mutationFn: (body: CloseDayBody) => api.post<CloseDayResult>('/closings', body),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.dailyReport(branchId, date ?? 'today') });
      void qc.invalidateQueries({ queryKey: qk.openClosing(branchId, date ?? 'today') });
      void qc.invalidateQueries({ queryKey: qk.businessDay(branchId) });
      void qc.invalidateQueries({ queryKey: ['home', branchId] });
      invalidateMoney(qc);
    },
  });
}

// ── Correct a transaction (docs/51 §15) ────────────────────────────────────

/** What can be done to a record now; the server's preview has the last word. */
export type { CorrectionAction };

export interface SourceRow {
  kind: 'sale' | 'payment' | 'refund' | 'expense' | 'purchase' | 'correction';
  id: string;
  at: string | null;
  localTime: string | null;
  amount: number;
  channel: 'cash' | 'account' | null;
  accountLabel: string | null;
  status: string;
  detail: Record<string, unknown>;
  recordedBy: string | null;
  actions: CorrectionAction[];
  /** The record's own screen. */
  open: 'sale' | 'return' | 'expense' | null;
  /** Why nothing can be done here, when nothing can. */
  refusal: string | null;
}

/** A request waiting for the Owner, whatever day it concerns. */
export interface PendingCorrection {
  id: string;
  targetKind: 'sale_payment' | 'sale' | 'expense' | 'supplier_payment' | 'purchase' | 'refund_payout' | 'supplier_settlement';
  action: 'reverse' | 'reclassify' | 'cancel';
  amount: number;
  method: 'cash' | 'account' | null;
  accountLabel: string | null;
  to: { method: 'cash' | 'account' | null; accountLabel: string | null } | null;
  reason: string;
  requestedBy: string | null;
  requestedAt: string;
  version: number;
  label: string | null;
  /** Another request for the same record was approved first: this one can only be rejected. */
  superseded: boolean;
}

export interface ClosingSources {
  date: string;
  today: string;
  canRequest: boolean;
  canApprove: boolean;
  rows: SourceRow[];
  pending: PendingCorrection[];
}

export function useClosingSources(date?: string) {
  const branchId = useBranch((s) => s.branchId);
  return useQuery({
    queryKey: qk.closingSources(branchId, date ?? 'today'),
    queryFn: () => api.get<ClosingSources>(`/closings/sources${date ? `?date=${date}` : ''}`),
    staleTime: 0,
  });
}

/** What the phone sends to preview or ask for a correction. The record's own figures are never sent. */
export interface CorrectionBody {
  targetKind: 'sale_payment' | 'sale' | 'expense' | 'supplier_payment' | 'purchase';
  action?: 'reverse' | 'reclassify' | 'cancel';
  targetId: string;
  toMethod?: 'cash' | 'account';
  toAccountId?: string;
  amount?: number;
}

/** The body for one action on one record. */
export function correctionBodyOf(action: CorrectionAction, targetId: string): CorrectionBody {
  switch (action) {
    case 'cancel_sale':
      return { targetKind: 'sale', action: 'cancel', targetId };
    case 'reverse_payment':
      return { targetKind: 'sale_payment', action: 'reverse', targetId };
    case 'reclassify_payment':
      return { targetKind: 'sale_payment', action: 'reclassify', targetId };
    case 'reverse_expense':
      return { targetKind: 'expense', action: 'reverse', targetId };
    case 'reclassify_purchase_payment':
      return { targetKind: 'supplier_payment', action: 'reclassify', targetId };
    case 'cancel_purchase':
      return { targetKind: 'purchase', action: 'cancel', targetId };
  }
}

export interface PreviewLeg {
  direction: 'in' | 'out';
  method: 'cash' | 'account';
  accountId: string | null;
  accountLabel: string | null;
  amount: number;
}

/**
 * What a correction would do, as the server says — nothing written. The common
 * part is always there; each kind adds what its record needs (the phones going
 * back, the debt before and after, the stock afterwards).
 */
export interface CorrectionPreview {
  targetKind: CorrectionBody['targetKind'];
  action: 'reverse' | 'reclassify' | 'cancel';
  amount: number;
  legs: PreviewLeg[];
  correctionDate: string;
  dayClosed: boolean;
  refusal: string | null;
  refusalMessage: string | null;
  /** A sale payment reversed: the sale before and after, and who owes it. */
  sale?: { total: number; before: { collected: number; owed: number }; after: { collected: number; owed: number } } & Record<string, unknown>;
  debtor?: { kind: 'customer' | 'store'; name: string } | null;
  /** A move: what does not change on the sale. */
  unchanged?: { saleTotal: number; collected: number; owed: number };
  /** A sale or a purchase cancelled: what goes back or leaves. */
  items?: { name: string; identifier: string | null; quantity: number }[];
  units?: { name: string; identifier: string | null }[];
  stock?: { name: string; bought: number; onHand: number; onHandAfter: number | null }[];
  moneyBack?: { method: 'cash' | 'account'; accountId: string | null; accountLabel: string | null; amount: number }[];
  moneyBackTotal?: number;
  expense?: { id: string; category: string; amount: number; day: string | null };
}

export function usePreviewCorrection() {
  return useMutation({
    mutationFn: (body: CorrectionBody) => api.post<CorrectionPreview>('/corrections/preview', body),
  });
}

export interface CorrectionRecord {
  id: string;
  status: 'requested' | 'approved' | 'rejected';
  version: number;
  correctionDate: string | null;
}

/** Everything a correction may move: the day's report and sources, money, sales, stock, expenses. */
function invalidateAfterCorrection(qc: ReturnType<typeof useQueryClient>, branchId: string | null, date?: string) {
  void qc.invalidateQueries({ queryKey: qk.closingSources(branchId, date ?? 'today') });
  void qc.invalidateQueries({ queryKey: qk.closingSources(branchId, 'today') });
  void qc.invalidateQueries({ queryKey: qk.dailyReport(branchId, date ?? 'today') });
  void qc.invalidateQueries({ queryKey: qk.dailyReport(branchId, 'today') });
  void qc.invalidateQueries({ queryKey: ['corrections'] });
  void qc.invalidateQueries({ queryKey: ['sales'] });
  void qc.invalidateQueries({ queryKey: ['sale'] });
  void qc.invalidateQueries({ queryKey: ['expenses'] });
  void qc.invalidateQueries({ queryKey: ['expense'] });
  void qc.invalidateQueries({ queryKey: ['inventory'] });
  void qc.invalidateQueries({ queryKey: ['inventory-value'] });
  void qc.invalidateQueries({ queryKey: ['inventory-by-model'] });
  void qc.invalidateQueries({ queryKey: ['home', branchId] });
  invalidateMoney(qc);
}

/**
 * Ask for a correction (reason required), and — for somebody who may approve —
 * approve it in the same step. Both acts are recorded separately on the server
 * even when one person does both.
 */
export function useCorrect(date?: string) {
  const qc = useQueryClient();
  const branchId = useBranch((s) => s.branchId);
  return useMutation({
    mutationFn: async (input: CorrectionBody & { reason: string; clientUuid: string; approve: boolean }) => {
      const { approve, ...body } = input;
      const requested = await api.post<CorrectionRecord>('/corrections', body);
      if (!approve || requested.status !== 'requested') return requested;
      return api.post<CorrectionRecord>(`/corrections/${requested.id}/approve`, { expectedVersion: requested.version });
    },
    onSettled: () => invalidateAfterCorrection(qc, branchId, date),
  });
}

/** The Owner's decision on a request that is waiting. */
export function useDecideCorrection(date?: string) {
  const qc = useQueryClient();
  const branchId = useBranch((s) => s.branchId);
  return useMutation({
    mutationFn: (input: { id: string; version: number; decision: 'approve' | 'reject'; note?: string }) =>
      api.post<CorrectionRecord>(`/corrections/${input.id}/${input.decision}`, {
        expectedVersion: input.version,
        ...(input.note ? { note: input.note } : {}),
      }),
    onSettled: () => invalidateAfterCorrection(qc, branchId, date),
  });
}
