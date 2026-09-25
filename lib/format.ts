import { format as formatDateFns, formatDistanceToNowStrict, isToday, isYesterday } from 'date-fns';
import { getLanguage } from './i18n';
import { dateLocaleFor } from './date-locale';
import { calendarDate, dayRangeShape } from './day-range';

/**
 * Formatting — money, quantities and dates, in one place.
 *
 * The money half lives in `./money-format`, which imports nothing at all, so it
 * can be tested under bare `node` and cannot drift into a second
 * implementation. It is re-exported here: every existing `from './format'`
 * import keeps working, and there is still exactly one formatter behind every
 * screen, button, card, receipt and export.
 *
 * Dates stay here because they need the active language and date-fns.
 */

export {
  ABSENT,
  CURRENCY_CODE,
  formatMoney,
  formatNumber,
  formatPercent,
  formatQuantity,
  isMoneyHidden,
  type MoneyOptions,
} from './money-format';

// ── Dates ───────────────────────────────────────────────────────────────────

function dateLocale() {
  return dateLocaleFor(getLanguage());
}

/** A bare `YYYY-MM-DD` is a calendar day, not UTC midnight: read so, it is the same day on every phone. */
function toDate(value: string | number | Date): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return calendarDate(value);
  return new Date(value);
}

/** Time only — for a list of today's sales. */
export function formatTime(value: string | number | Date): string {
  return formatDateFns(toDate(value), 'HH:mm', { locale: dateLocale() });
}

/** Calendar date, no time. */
export function formatDate(value: string | number | Date): string {
  return formatDateFns(toDate(value), 'd MMM yyyy', { locale: dateLocale() });
}

/**
 * A span of days the short way a person says it: "14–18 Sep 2026" inside one
 * month, "28 Aug – 3 Sep 2026" across two, both dates in full across a year.
 * One day is just that day. Deliberately not LTR-isolated: a localised date
 * carries its own month word (see `PeriodSelector`).
 */
export function formatDayRange(from: string, to: string): string {
  const day = (d: string, pattern: string) => formatDateFns(calendarDate(d), pattern, { locale: dateLocale() });
  switch (dayRangeShape(from, to)) {
    case 'day':
      return day(from, 'd MMM yyyy');
    case 'month':
      return `${day(from, 'd')}–${day(to, 'd MMM yyyy')}`;
    case 'year':
      return `${day(from, 'd MMM')} – ${day(to, 'd MMM yyyy')}`;
    default:
      return `${day(from, 'd MMM yyyy')} – ${day(to, 'd MMM yyyy')}`;
  }
}

export function formatDateTime(value: string | number | Date): string {
  return formatDateFns(toDate(value), 'd MMM yyyy · HH:mm', { locale: dateLocale() });
}

/**
 * How a person would say it: "14:32" for today, "Yesterday 09:10", otherwise a
 * date. Used in timelines and activity lists.
 */
export function formatSmartDateTime(value: string | number | Date): string {
  const date = toDate(value);
  const time = formatTime(date);
  if (isToday(date)) return time;
  if (isYesterday(date)) return `${formatDateFns(date, 'EEEE', { locale: dateLocale() })} ${time}`;
  return formatDateTime(date);
}

/** "3 days ago" — for dead stock and last-sold hints. */
export function formatRelative(value: string | number | Date): string {
  return formatDistanceToNowStrict(toDate(value), { addSuffix: true, locale: dateLocale() });
}

/** The `YYYY-MM-DD` form the backend expects for date query params. */
export function toApiDate(value: Date = new Date()): string {
  return formatDateFns(value, 'yyyy-MM-dd');
}
