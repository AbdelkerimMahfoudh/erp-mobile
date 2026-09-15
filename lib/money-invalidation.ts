import type { QueryClient } from '@tanstack/react-query';

/**
 * Query prefixes that show money for a period: Home's four figures and Results
 * (`analytics-summary`), and Money's per-channel movement (`money-movements`).
 *
 * Anything that moves money — a sale, a purchase, a confirmed expense or refund,
 * an approved correction, a closing — invalidates all of them, so no screen goes
 * on showing a period the mutation just changed.
 */
export const MONEY_QUERY_PREFIXES = ['analytics-summary', 'money-movements'] as const;

export function invalidateMoney(qc: Pick<QueryClient, 'invalidateQueries'>): void {
  for (const key of MONEY_QUERY_PREFIXES) void qc.invalidateQueries({ queryKey: [key] });
}
