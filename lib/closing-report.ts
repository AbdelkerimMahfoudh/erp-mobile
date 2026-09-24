import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api-client';
import { useBranch } from './branch';
import { qk } from './query-keys';
import { invalidateMoney } from './money-invalidation';
import type { DayStanding } from './home-day';
import type { Verification } from './closing-report-view';

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
    returns: { count: number; grossRefund: number; adjustments: number; netRefundDue: number };
    netSalesValue: number;
    collected: { atCheckout: number; laterSameDay: number; total: number };
    owed: number;
  } | null;
  money: {
    channels: ReportChannel[];
    totals: { in: number; out: number; net: number; todaysSales: number; olderDebts: number };
    pending: { refundReports: { count: number; amount: number }; expenseReports: { count: number; amount: number } } | null;
  };
  expenses: {
    total: number;
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

// ── Correct a transaction ───────────────────────────────────────────────────

export interface SourceRow {
  kind: 'payment' | 'refund' | 'expense' | 'supplier_payment' | 'correction';
  id: string;
  at: string | null;
  localTime: string | null;
  amount: number;
  channel: string;
  accountLabel: string | null;
  status: string;
  detail: Record<string, unknown>;
  recordedBy: string | null;
  action: 'reclassify_payment' | 'open_return' | 'open_expense' | 'open_sale' | null;
  refusal: string | null;
}

export function useClosingSources(date?: string) {
  const branchId = useBranch((s) => s.branchId);
  return useQuery({
    queryKey: qk.closingSources(branchId, date ?? 'today'),
    queryFn: () => api.get<{ date: string; today: string; canRequest: boolean; rows: SourceRow[] }>(`/closings/sources${date ? `?date=${date}` : ''}`),
    staleTime: 0,
  });
}

export interface ReclassifyBody {
  targetId: string;
  toMethod: 'cash' | 'account';
  toAccountId?: string;
  amount?: number;
}

export interface ReclassifyPreview {
  payment: { id: string; saleId: string; invoiceNo: string | null; amount: number; method: 'cash' | 'account'; accountLabel: string | null; paymentDay: string };
  move: {
    amount: number;
    from: { method: 'cash' | 'account'; accountId: string | null; accountLabel: string | null };
    to: { method: 'cash' | 'account'; accountId: string | null; accountLabel: string | null };
  };
  correctionDate: string;
  dayClosed: boolean;
  unchanged: { saleTotal: number; collected: number; owed: number };
  refusal: string | null;
}

/** What moving a payment would do — writes nothing. */
export function usePreviewReclassify() {
  return useMutation({
    mutationFn: (body: ReclassifyBody) => api.post<ReclassifyPreview>('/corrections/preview', { targetKind: 'sale_payment', ...body }),
  });
}

export interface CorrectionRecord {
  id: string;
  status: 'requested' | 'approved' | 'rejected';
  version: number;
  correctionDate: string | null;
}

/**
 * Ask for the reclassification (reason required), and — for somebody who may
 * approve — approve it in the same step. Both acts are recorded separately on
 * the server even when one person does both.
 */
export function useReclassifyPayment(date?: string) {
  const qc = useQueryClient();
  const branchId = useBranch((s) => s.branchId);
  return useMutation({
    mutationFn: async (input: ReclassifyBody & { reason: string; clientUuid: string; approve: boolean }) => {
      const requested = await api.post<CorrectionRecord>('/corrections', {
        targetKind: 'sale_payment',
        targetId: input.targetId,
        toMethod: input.toMethod,
        ...(input.toAccountId ? { toAccountId: input.toAccountId } : {}),
        ...(input.amount != null ? { amount: input.amount } : {}),
        reason: input.reason,
        clientUuid: input.clientUuid,
      });
      if (!input.approve || requested.status !== 'requested') return requested;
      return api.post<CorrectionRecord>(`/corrections/${requested.id}/approve`, { expectedVersion: requested.version });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.closingSources(branchId, date ?? 'today') });
      void qc.invalidateQueries({ queryKey: qk.dailyReport(branchId, date ?? 'today') });
      void qc.invalidateQueries({ queryKey: qk.dailyReport(branchId, 'today') });
      void qc.invalidateQueries({ queryKey: ['corrections'] });
      invalidateMoney(qc);
    },
  });
}
