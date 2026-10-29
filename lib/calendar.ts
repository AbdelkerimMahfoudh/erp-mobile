/**
 * Calendar periods in business dates (D225) — the one place the app decides what "this week" means.
 *
 * A week is a calendar week, Monday through Sunday, never the last seven rolling days. Every date
 * here is a BUSINESS date (the server's 06:00 rule in the store's zone, `Africa/Nouakchott` for the
 * first market), the dates every rollup, closing and period endpoint is keyed on, so a week's total
 * is the sum of its closings and the phone and the server can never disagree about which week a
 * sale belongs to. The server's twin is `calendarWeekOf` in `src/common/business-day.ts`; both are
 * pinned by the same boundary cases.
 *
 * Pure calendar arithmetic on YYYY-MM-DD strings, with no timezone and no clock: importable under
 * bare node for the tests.
 */

export interface CalendarRange {
  readonly from: string;
  readonly to: string;
}

const DAY_MS = 86_400_000;

/** A YYYY-MM-DD shifted by whole days. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay(); // 0 = Sunday
  return day === 0 ? 7 : day;
}

/** The calendar week a business date belongs to: its Monday through its Sunday. */
export function calendarWeekOf(date: string): CalendarRange {
  const from = addDays(date, 1 - isoWeekday(date));
  return { from, to: addDays(from, 6) };
}

/** This week so far: Monday to the given business date (the rest of the week has not happened yet). */
export function weekToDate(date: string): CalendarRange {
  return { from: calendarWeekOf(date).from, to: date };
}

/** This month so far: the first of the month to the given business date. */
export function monthToDate(date: string): CalendarRange {
  return { from: `${date.slice(0, 7)}-01`, to: date };
}

/** How many days a range spans, both ends included. */
export function daysIn(range: CalendarRange): number {
  return Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / DAY_MS) + 1;
}
