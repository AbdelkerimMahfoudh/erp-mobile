import { format as formatDateFns, formatDistanceToNowStrict, isToday, isYesterday } from 'date-fns';
import { getLanguage } from './i18n';
import { dateLocaleFor } from './date-locale';

/**
 * Formatting — money, quantities and dates, in one place.
 *
 * Deliberately built WITHOUT `Intl`. Hermes ships inconsistent ICU coverage
 * across platforms, and `toLocaleString` with currency options can silently
 * ignore what you asked for. Money is the highest-stakes text in this app; a
 * price that renders differently on one employee's phone is a real-world
 * mistake. So grouping is done by hand and dates go through date-fns, both of
 * which behave identically everywhere.
 */

/** Mauritanian ouguiya. */
export const CURRENCY_CODE = 'MRU';

/**
 * Mauritanian retail prices are quoted in whole ouguiya — the khoums subunit is
 * not used at a counter. The backend keeps DECIMAL(14,2) precision; this is a
 * display decision only, and no arithmetic is ever done on a formatted string.
 */
const DEFAULT_DECIMALS = 0;

/** Narrow no-break space: groups digits without letting them wrap apart. */
const GROUP_SEPARATOR = ' ';
const DECIMAL_SEPARATOR = ',';
/** Non-breaking space, so "45 000 MRU" never splits across lines. */
const CURRENCY_SEPARATOR = ' ';

/** Shown wherever a value is absent — including cost the server stripped. */
export const ABSENT = '—';

function groupDigits(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEPARATOR);
}

/** Format a bare number with grouping, no currency. */
export function formatNumber(value?: number | null, decimals = 0): string {
  if (value === undefined || value === null || Number.isNaN(value)) return ABSENT;
  const negative = value < 0;
  const fixed = Math.abs(value).toFixed(decimals);
  const [intPart, fracPart] = fixed.split('.');
  const grouped = groupDigits(intPart);
  const body = fracPart ? `${grouped}${DECIMAL_SEPARATOR}${fracPart}` : grouped;
  return negative ? `-${body}` : body;
}

export interface MoneyOptions {
  /** Show the currency code. Off inside a column already labelled as money. */
  showCurrency?: boolean;
  decimals?: number;
  /** Force a leading + on positive values — for deltas and adjustments. */
  signed?: boolean;
}

/**
 * Format money. Returns `—` for null/undefined, which is what a caller without
 * `cost.view` receives once the server has stripped the field.
 */
export function formatMoney(value?: number | null, options: MoneyOptions = {}): string {
  const { showCurrency = true, decimals = DEFAULT_DECIMALS, signed = false } = options;
  if (value === undefined || value === null || Number.isNaN(value)) return ABSENT;

  const body = formatNumber(value, decimals);
  const withSign = signed && value > 0 ? `+${body}` : body;
  return showCurrency ? `${withSign}${CURRENCY_SEPARATOR}${CURRENCY_CODE}` : withSign;
}

/** True when a money field was withheld rather than being genuinely zero. */
export function isMoneyHidden(value?: number | null): boolean {
  return value === undefined || value === null;
}

/** Whole-unit counts — never fractional, never currency. */
export function formatQuantity(value?: number | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) return ABSENT;
  return formatNumber(Math.trunc(value), 0);
}

export function formatPercent(value?: number | null, decimals = 0): string {
  if (value === undefined || value === null || Number.isNaN(value)) return ABSENT;
  return `${formatNumber(value, decimals)}%`;
}

// ── Dates ───────────────────────────────────────────────────────────────────

function dateLocale() {
  return dateLocaleFor(getLanguage());
}

function toDate(value: string | number | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Time only — for a list of today's sales. */
export function formatTime(value: string | number | Date): string {
  return formatDateFns(toDate(value), 'HH:mm', { locale: dateLocale() });
}

/** Calendar date, no time. */
export function formatDate(value: string | number | Date): string {
  return formatDateFns(toDate(value), 'd MMM yyyy', { locale: dateLocale() });
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
