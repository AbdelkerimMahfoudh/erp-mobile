import type { ProfitBlock } from './analytics-summary';

/**
 * The Results breakdown, in the order a shopkeeper reads it, straight from the
 * server's profit block. Nothing is recomputed: each line is a field the server
 * already calculated (`accounting-rules.ts`), so the lines always add up the way
 * the server says they do.
 *
 *   Sales − approved returns = sales after returns
 *   − cost of sold items (net of returned cost) = profit before expenses
 *   − confirmed expenses = final profit
 */
export interface ResultLines {
  sales: number;
  approvedReturns: number;
  salesAfterReturns: number;
  costOfSoldItems: number;
  profitBeforeExpenses: number;
  expenses: number;
  finalProfit: number;
}

export function resultLines(p: ProfitBlock): ResultLines {
  return {
    sales: p.grossSales,
    approvedReturns: p.returnsRevenue,
    salesAfterReturns: p.netRevenue,
    costOfSoldItems: p.netCogs,
    profitBeforeExpenses: p.grossProfit,
    expenses: p.expenses,
    finalProfit: p.netOperatingProfit,
  };
}
