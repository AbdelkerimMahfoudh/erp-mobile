import type { ProfitBlock } from './analytics-summary';

/**
 * The Results breakdown, in the order a shopkeeper reads it, straight from the
 * server's profit block. Nothing is recomputed: each line is a field the server
 * already calculated (`accounting-rules.ts`), so the lines always add up the way
 * the server says they do.
 *
 *   Sales − approved returns − cancelled sales = net sales
 *   − cost of sold items (net of returned and cancelled cost) = profit before expenses
 *   − confirmed expenses = final profit
 */
export interface ResultLines {
  sales: number;
  approvedReturns: number;
  /** A cancelled sale stays in the sales of the day it was sold and comes off here, in the period it was cancelled. */
  cancelledSales: number;
  netSales: number;
  costOfSoldItems: number;
  profitBeforeExpenses: number;
  expenses: number;
  finalProfit: number;
}

export function resultLines(p: ProfitBlock): ResultLines {
  return {
    sales: p.grossSales,
    approvedReturns: p.returnsRevenue,
    cancelledSales: p.cancelledRevenue,
    netSales: p.netRevenue,
    costOfSoldItems: p.netCogs,
    profitBeforeExpenses: p.grossProfit,
    expenses: p.expenses,
    finalProfit: p.netOperatingProfit,
  };
}
