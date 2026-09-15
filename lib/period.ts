import { create } from 'zustand';

/**
 * The period Money and Results are looking at — one choice, shared.
 *
 * Changing it on Money and then opening Results must show the same days, or the
 * two screens quietly answer different questions. So the choice lives here,
 * outside either screen, and both read it.
 *
 * Days are calendar days in UTC, the way the server keys `daily_rollups`, the
 * closing and every period endpoint. "This month" is month-to-date, the same
 * window Home's four figures use.
 */

export type PeriodKey = 'today' | 'week' | 'month';

export const PERIOD_KEYS: readonly PeriodKey[] = ['today', 'week', 'month'];

export interface DayRange {
  readonly from: string;
  readonly to: string;
}

/** The inclusive day range a period covers, ending today. Pure, for tests. */
export function periodRange(key: PeriodKey, now: Date = new Date()): DayRange {
  const to = now.toISOString().slice(0, 10);
  if (key === 'today') return { from: to, to };
  if (key === 'month') return { from: `${to.slice(0, 7)}-01`, to };
  const from = new Date(Date.parse(`${to}T00:00:00.000Z`) - 6 * 86_400_000).toISOString().slice(0, 10);
  return { from, to };
}

interface PeriodState {
  key: PeriodKey;
  setKey: (key: PeriodKey) => void;
}

export const usePeriod = create<PeriodState>((set) => ({
  key: 'month',
  setKey: (key) => set({ key }),
}));

/** How many days a period spans, for tools that take a day count (the export). */
export function periodDays(key: PeriodKey, now: Date = new Date()): number {
  const r = periodRange(key, now);
  return Math.round((Date.parse(`${r.to}T00:00:00Z`) - Date.parse(`${r.from}T00:00:00Z`)) / 86_400_000) + 1;
}
