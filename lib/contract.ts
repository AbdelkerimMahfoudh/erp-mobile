/**
 * What a screen needs from the server, checked before anything is drawn (docs/54).
 *
 *   node lib/contract.test.ts
 *
 * A server one version behind the app answers with a shape the screen does not
 * expect: a figure the screen reads is simply not there. Read as-is, that either
 * crashes the screen (`figures.returns.count` of undefined) or — worse — shows a
 * missing amount as 0, which a shop would believe. So each money read names the
 * figures it needs; a reply without one of them is refused as a whole and the
 * screen says the server needs updating. Nothing is filled in, nothing is zero.
 *
 * Imports nothing at runtime, so it runs under bare node.
 */
import type { HomeResponse } from './home';
import type { MoneyOverview, SalesDay } from './money-overview';

export class IncompatibleResponse extends Error {
  readonly code = 'incompatible_response';
  readonly endpoint: string;
  /** Each path the reply lacked, e.g. `figures.returns.count`. */
  readonly missing: readonly string[];
  constructor(endpoint: string, missing: readonly string[]) {
    super(`${endpoint} answered without ${missing.join(', ')}`);
    this.name = 'IncompatibleResponse';
    this.endpoint = endpoint;
    this.missing = missing;
  }
}

const at = (value: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((o, key) => (o !== null && typeof o === 'object' ? (o as Record<string, unknown>)[key] : undefined), value);

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** The paths of `value`, prefixed, that are not finite numbers. */
export function missingNumbers(value: unknown, paths: readonly string[], prefix = ''): string[] {
  return paths.filter((p) => !isNumber(at(value, p))).map((p) => `${prefix}${p}`);
}

function missingTexts(value: unknown, paths: readonly string[], prefix = ''): string[] {
  return paths.filter((p) => !isText(at(value, p))).map((p) => `${prefix}${p}`);
}

/** Every element of an array at `path`, each checked; the array itself must be there. */
function missingInRows(value: unknown, path: string, check: (row: unknown, prefix: string) => string[]): string[] {
  const rows = at(value, path);
  if (!Array.isArray(rows)) return [path];
  return rows.flatMap((row, i) => check(row, `${path}.${i}.`));
}

/** Retry a failure that may pass once; never a reply that cannot. */
export function retryUnlessIncompatible(failureCount: number, error: unknown): boolean {
  return !(error instanceof IncompatibleResponse) && failureCount < 1;
}

function refuseIfMissing<T>(endpoint: string, value: T, missing: string[]): T {
  if (missing.length > 0) throw new IncompatibleResponse(endpoint, missing);
  return value;
}

export const HOME_FIGURES = [
  'salesValue',
  'salesCount',
  'phonesSold',
  'cancellations.count',
  'cancellations.value',
  'cancellations.phones',
  'returns.count',
  'returns.value',
  'returns.phones',
  'netSalesValue',
  'collected',
  'expenses',
  'expensesRecorded',
  'expensesReversed',
  'expensesCount',
  'stillOwed',
] as const;

/**
 * Home's one read. `figures` and `series` are `null` for a person who may not see
 * money — hidden, and allowed; `undefined` means the server did not say, and is not.
 */
export function checkHome(r: HomeResponse): HomeResponse {
  const missing: string[] = [];
  missing.push(...missingTexts(r, ['range.from', 'range.to', 'businessDay.businessDate', 'businessDay.localDate', 'businessDay.timezone']));
  if (r?.figures !== null) missing.push(...missingNumbers(r?.figures, HOME_FIGURES, 'figures.'));
  if (r?.series !== null) {
    missing.push(...missingNumbers(r?.series, ['total'], 'series.'));
    missing.push(...missingInRows(r, 'series.bars', (bar, prefix) => missingNumbers(bar, ['value'], prefix)));
  }
  missing.push(...missingInRows(r, 'arrivals', (a, prefix) => missingTexts(a, ['label', 'receivedLocalDate', 'receivedLocalTime'], prefix)));
  if (r?.partners === undefined) missing.push('partners');
  return refuseIfMissing('/home', r, missing);
}

const MONEY_PERIOD = [
  'unitsSold',
  'salesCount',
  'salesValue',
  'cancellations.count',
  'cancellations.value',
  'returns.count',
  'returns.value',
  'adjusted',
  'netSalesValue',
  'collected',
  'outstanding',
  'refunds',
] as const;

/** The Money tab's overview: the business day it speaks of, the period, the cash now, and today's expense rows. */
export function checkMoneyOverview(r: MoneyOverview): MoneyOverview {
  const missing = [
    ...missingTexts(r, ['today']),
    ...missingNumbers(r, ['cashNow']),
    ...missingNumbers(r?.period, MONEY_PERIOD, 'period.'),
    ...missingNumbers(r?.expensesToday, ['total', 'recorded', 'reversed'], 'expensesToday.'),
    ...missingInRows(r, 'expensesToday.rows', (row, prefix) => missingNumbers(row, ['amount'], prefix)),
  ];
  return refuseIfMissing('/closings/overview', r, missing);
}

const SALES_DAY = ['sales', 'units', 'value', 'cancelled', 'returned', 'returns', 'adjusted', 'net'] as const;

/** Sales by day: each day's net and what came off it. */
export function checkSalesByDay<T extends { days: SalesDay[] }>(r: T): T {
  return refuseIfMissing('/sales/by-day', r, missingInRows(r, 'days', (day, prefix) => missingNumbers(day, SALES_DAY, prefix)));
}
