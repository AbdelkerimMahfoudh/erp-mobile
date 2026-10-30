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
 * Pure calendar arithmetic on YYYY-MM-DD strings, with no clock: importable under bare node for the
 * tests. The one instant-to-date reading, `businessDateOf`, is the server's 06:00 rule for the moment
 * before the server has answered which business date it is.
 */

export interface CalendarRange {
  readonly from: string;
  readonly to: string;
}

const DAY_MS = 86_400_000;

/** A business day starts at 06:00 on the store's clock (docs/50 §3.1, D225). */
export const BUSINESS_DAY_START_HOUR = 6;

/** The first market's zone: UTC+0 all year, no daylight saving. */
export const DEFAULT_BUSINESS_TIMEZONE = 'Africa/Nouakchott';

/**
 * The business date an instant belongs to, by the 06:00 rule on `timeZone`'s clock — never the
 * phone's own zone. The server's `businessDateOf` is the authority; this is its twin for the moment
 * before the server has answered. Only `Intl.DateTimeFormat.format` is used (Hermes has no reliable
 * `formatToParts`, see `zoned-time.ts`); a zone the device cannot read falls back to UTC's clock.
 */
export function businessDateOf(instant: Date, timeZone: string = DEFAULT_BUSINESS_TIMEZONE): string {
  let date = instant.toISOString().slice(0, 10);
  let hour = instant.getUTCHours();
  try {
    // "11/2/2026, 05:59": US English writes the month, the day, the year, the hour and the minute.
    const fields = (
      new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
        .format(instant)
        .match(/\d+/g) ?? []
    ).map(Number);
    if (fields.length === 5) {
      const [month, day, year] = fields;
      date = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      hour = fields[3] % 24;
    }
  } catch {
    // Unknown zone on this device: UTC's clock, as read above.
  }
  return hour < BUSINESS_DAY_START_HOUR ? addDays(date, -1) : date;
}

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
