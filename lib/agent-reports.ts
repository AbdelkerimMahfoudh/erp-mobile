import { addDays } from './agent-history.ts';

/**
 * The counter's reports as the phone moves through them (D157): a day, a week
 * (Monday to Sunday), a month or a year (by month) around a business date —
 * exactly the server's periods (`erp-backend/src/agent/agent-report-rules.ts`,
 * `periodRangeOf`), so the dates the phone names are the dates the figures
 * cover. The figures themselves are never added up here: every count, volume
 * and commission is the server's.
 *
 *   node lib/agent-reports.test.ts
 */

export type ReportPeriod = 'day' | 'week' | 'month' | 'year';
export const REPORT_PERIODS: readonly ReportPeriod[] = ['day', 'week', 'month', 'year'];

/** The business dates a period covers around a date: the week is Monday to Sunday; the year, January to December. */
export function reportRange(period: ReportPeriod, date: string): { from: string; to: string } {
  if (period === 'day') return { from: date, to: date };
  if (period === 'week') {
    const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay(); // 0 = Sunday
    const from = addDays(date, -((weekday + 6) % 7));
    return { from, to: addDays(from, 6) };
  }
  if (period === 'month') {
    const from = `${date.slice(0, 7)}-01`;
    const [y, m] = date.split('-').map(Number);
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    return { from, to: addDays(next, -1) };
  }
  return { from: `${date.slice(0, 4)}-01-01`, to: `${date.slice(0, 4)}-12-31` };
}

/** A date inside the period before (−1) or after (+1) the one shown: the day before its first day, or after its last. */
export function stepDate(range: { from: string; to: string }, step: -1 | 1): string {
  return step < 0 ? addDays(range.from, -1) : addDays(range.to, 1);
}

/** A later period exists to look at only while the one shown ends before the branch's business day. */
export function hasLaterPeriod(range: { to: string }, today: string | null): boolean {
  return today !== null && range.to < today;
}

/** Whether the period shown contains the branch's business day — "so far", its figures still moving. */
export function isCurrentPeriod(range: { from: string; to: string }, today: string | null): boolean {
  return today !== null && range.from <= today && today <= range.to;
}

interface CountsLike {
  count: number;
  reversals: { count: number };
  rebalancings?: { count: number };
}

/** Nothing happened in the period: no exchange, no reversal, no rebalancing — said, rather than a page of zeros. */
export function isEmptyPeriod(totals: CountsLike): boolean {
  return totals.count === 0 && totals.reversals.count === 0 && (totals.rebalancings?.count ?? 0) === 0;
}
