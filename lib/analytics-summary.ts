import { useQuery } from '@tanstack/react-query';
import { api } from './api-client';
import { useBranch } from './branch';
import { qk } from './query-keys';

/**
 * The consolidated period summary (Milestone L).
 *
 * Every figure is calculated by the server, from the source that already owns
 * it. Nothing here derives profit, cash or a comparison: two ways of computing
 * profit is how a shop ends up with two answers and trusts neither.
 *
 * The seven categories are kept apart in the type for the same reason they are
 * kept apart on screen — a shop reading cash as profit makes a decision on a
 * number that does not mean what they think.
 */

export interface ProfitBlock {
  grossSales: number;
  returnsRevenue: number;
  /** Sales cancelled in the period, on the day each cancellation was approved (0079). */
  cancelledRevenue: number;
  netRevenue: number;
  cogs: number;
  returnsCogs: number;
  cancelledCogs: number;
  netCogs: number;
  grossProfit: number;
  expenses: number;
  netOperatingProfit: number;
}

export interface CashBlock {
  inflow: number;
  outflow: number;
  net: number;
  salesReceived: number;
  refundsPaid: number;
  supplierPaymentsConfirmed: number;
  expensesCash: number;
}

export type Comparison =
  | { available: true; previous: number; change: number; changePercent: number }
  | { available: false; previous: number; reason: 'no_previous_activity' };

export interface PeriodSummary {
  from: string;
  to: string;
  /** Absent without `cost.view`: the server strips the whole block. */
  profit?: ProfitBlock;
  cash: CashBlock;
  expenseDetail: { total: number; fixed: number; salaries: number; count: number };
  /**
   * What customers actually paid in the period, across cash and accounts.
   *
   * A different question from revenue and from profit: a credit sale is revenue
   * nobody has paid yet, and settling last month's balance is money arriving
   * against no new sale. Refunds are NOT netted off — they are money going the
   * other way and keep their own line in `cash.refundsPaid`.
   *
   * Optional so an older server, which does not send it, renders as unavailable
   * rather than as a measured zero.
   */
  collected?: { total: number; cash: number; account: number; count: number };
  balances: {
    loansReceivable: number;
    loansPayable: number;
    consignmentBalance: number;
  };
  discrepancies: { open: number; total: number };
  comparison: {
    period: { from: string; to: string };
    netRevenue: Comparison;
    grossProfit: Comparison;
    netOperatingProfit: Comparison;
  };
  /**
   * Metrics with no canonical source. Rendered as unavailable, never as zero —
   * a shop cannot tell a measured zero from a figure nobody computed.
   */
  unavailable: string[];
}

export function usePeriodSummary(from: string, to: string, options: { enabled?: boolean } = {}) {
  const branchId = useBranch((s) => s.branchId);
  return useQuery({
    queryKey: qk.analyticsSummary(branchId, from, to),
    queryFn: () =>
      api.get<PeriodSummary>(
        `/analytics/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
    enabled: options.enabled ?? true,
  });
}

/** Inclusive day window ending today, as the server expects it. */
export function windowOf(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

/**
 * Whether a figure the server could not compute is being asked for.
 *
 * Used so a screen can say "not available" in words rather than drawing a zero
 * that looks measured.
 */
export function isUnavailable(summary: PeriodSummary | undefined, metric: string): boolean {
  return Boolean(summary?.unavailable.includes(metric));
}

/**
 * Direction of a change, for wording and tone.
 *
 * Returns `null` when there is nothing to compare against, so the screen shows
 * no arrow rather than a misleading flat one.
 */
export function trendOf(c: Comparison): 'up' | 'down' | 'flat' | null {
  if (!c.available) return null;
  if (c.change > 0) return 'up';
  if (c.change < 0) return 'down';
  return 'flat';
}
