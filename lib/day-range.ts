/**
 * How much of a span of days has to be said. Pure — the words themselves are
 * chosen in `format.ts`, with the active locale.
 *
 * One day is that day. Inside one month only the first day's number is
 * repeated ("14–18 Sep 2026"); inside one year both ends carry a month
 * ("28 Aug – 3 Sep 2026"); across years both are said in full.
 */
export type DayRangeShape = 'day' | 'month' | 'year' | 'full';

export function dayRangeShape(from: string, to: string): DayRangeShape {
  if (from === to) return 'day';
  if (from.slice(0, 7) === to.slice(0, 7)) return 'month';
  if (from.slice(0, 4) === to.slice(0, 4)) return 'year';
  return 'full';
}
