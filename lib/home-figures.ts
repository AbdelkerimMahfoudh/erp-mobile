import type { PeriodSummary } from './analytics-summary';

/**
 * Home's four figures, read from the server's period summary.
 *
 * Pure so a test can prove the permission rule: without `cost.view` the server
 * removes the whole `profit` block — profit, and also sales after returns — so
 * both come back `null` here and Home renders no card, no label and no
 * accessibility text for them. Expenses and collections are not cost figures
 * and stay.
 */
export interface HomeFigures {
  profit: { value: number; salesAfterReturns: number; cost: number; expenses: number } | null;
  sales: number | null;
  expenses: number;
  collected: number | null;
  /** Nothing moved at all — one short sentence instead of four zeros explained. */
  allZero: boolean;
}

export function homeFigures(s: Pick<PeriodSummary, 'profit' | 'expenseDetail' | 'collected'>): HomeFigures {
  const p = s.profit;
  const profit = p
    ? { value: p.netOperatingProfit, salesAfterReturns: p.netRevenue, cost: p.netCogs, expenses: p.expenses }
    : null;
  const sales = p ? p.netRevenue : null;
  const expenses = s.expenseDetail.total;
  const collected = s.collected ? s.collected.total : null;
  const allZero = (profit?.value ?? 0) === 0 && (sales ?? 0) === 0 && expenses === 0 && (collected ?? 0) === 0;
  return { profit, sales, expenses, collected, allZero };
}
