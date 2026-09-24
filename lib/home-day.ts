/**
 * What Home and the Closing screens may work out for themselves (docs/50).
 *
 *   node lib/home-day.test.ts
 *
 * Every figure, every date and every bar comes from the server: the business
 * date is the branch's, the ranges are exact, and the bars already add up to
 * the sales value. What is left to the phone is words — which catalogue key
 * names a day's standing, how a bar is labelled, what "refreshed" means — and
 * one privacy rule: an identifier on Home is only ever its last four digits.
 *
 * Imports nothing, so it runs under bare node.
 */

export type HomePeriod = 'today' | 'week' | 'month';

export const HOME_PERIODS: readonly HomePeriod[] = ['today', 'week', 'month'];

export type DayStanding = 'open' | 'counting' | 'counted' | 'closed' | 'reopened' | 'needs_review';

export type StandingTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/** The word and the colour for a day's standing — the word always travels with the colour. */
export function standingKey(standing: DayStanding): string {
  return `closing.standing.${standing}`;
}

export function standingTone(standing: DayStanding): StandingTone {
  switch (standing) {
    case 'closed':
      return 'success';
    case 'reopened':
    case 'needs_review':
      return 'warning';
    case 'counted':
      return 'info';
    case 'counting':
      return 'info';
    default:
      return 'neutral';
  }
}

export interface BarLike {
  key: string;
  label: string;
  from: string;
  to: string;
  value: number;
}

/**
 * The tick values of the bar axis: zero, a round step, and its multiples up to
 * just above the tallest bar. A round step is one people read without
 * thinking — 1 000, 2 000, 5 000 — never 1 337.
 */
export function axisTicks(max: number, count = 2): number[] {
  if (!(max > 0)) return [0];
  const rough = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const candidates = [1, 2, 2.5, 5, 10].map((m) => m * magnitude);
  const step = candidates.find((c) => c >= rough) ?? candidates[candidates.length - 1];
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.999; v += step) ticks.push(Math.round(v * 100) / 100);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

/** "2k" for the axis; whole numbers below a thousand. */
export function shortAmount(value: number): string {
  if (value >= 1_000_000) return `${trimZero(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trimZero(value / 1_000)}k`;
  return String(Math.round(value));
}

function trimZero(n: number): string {
  const s = n.toFixed(1);
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}

/**
 * Which bars carry a printed label. Twenty-four hours do not fit on a phone,
 * so every third hour is printed and the rest keep their value for the
 * screen reader; seven days and the weeks of a month are all printed.
 */
export function labelledEvery(unit: 'hour' | 'day' | 'week', width: number): number {
  if (unit === 'hour') return width < 360 ? 4 : 3;
  return 1;
}

/** The last four digits of an identifier, however it was masked upstream. */
export function lastFour(identifier: string): string {
  const digits = identifier.replace(/\D/g, '');
  return digits.slice(-4);
}

/** True when a full IMEI-length run of digits appears — never allowed on Home. */
export function looksLikeFullIdentifier(text: string): boolean {
  return /\d{15}/.test(text.replace(/[\s-]/g, ''));
}

/**
 * How Home describes the age of what it shows. Fresh within a minute; then
 * the relative time; offline is said separately so a stale figure is never
 * mistaken for a live one.
 */
export type Freshness = 'now' | 'stale';

export function freshness(fetchedAt: number | null | undefined, now: number = Date.now(), freshMs = 60_000): Freshness | null {
  if (!fetchedAt) return null;
  return now - fetchedAt <= freshMs ? 'now' : 'stale';
}

/**
 * The reopen sheet's choices, as the server offers them: the safe default
 * first and selected; the early start only when the server included it.
 */
export type ReopenMode = 'continue' | 'start_new';

export function reopenOptions(offered: readonly ReopenMode[]): { mode: ReopenMode; selected: boolean }[] {
  const modes = offered.length > 0 ? offered : (['continue'] as const);
  return modes.map((mode, i) => ({ mode, selected: i === 0 }));
}

/** Movement since the last count, or null when nothing has been counted yet. */
export function sinceLastCountTone(value: number | null): 'success' | 'danger' | 'neutral' {
  if (value === null || value === 0) return 'neutral';
  return value > 0 ? 'success' : 'danger';
}

/** The i18n key that names one history entry. */
export function historyKey(kind: string): string {
  switch (kind) {
    case 'count_saved':
    case 'closed':
    case 'reopened':
    case 'auto_reopened':
    case 'reclosed':
    case 'day_started_early':
    case 'opened':
    case 'first_activity':
    case 'sale':
      return `closing.history.${kind}`;
    default:
      return 'closing.history.other';
  }
}

/**
 * The line that says when the boutique opened (0077): an explicit opening or
 * a reopen, today or on a past date — or that no opening time was recorded.
 * The 06:00 boundary never counts as an opening.
 */
export function openingKey(opening: { kind: string } | null, isToday: boolean): string {
  if (!opening) return 'closingHistory.noOpening';
  const reopened = opening.kind === 'reopened' || opening.kind === 'auto_reopened';
  if (reopened) return isToday ? 'closingHistory.reopenedToday' : 'closingHistory.reopenedOn';
  return isToday ? 'closingHistory.openedToday' : 'closingHistory.openedOn';
}

/** Calendar arithmetic on a YYYY-MM-DD, with no timezone involved. */
export function shiftDay(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The business dates the selector offers: today first, then back `count` days. */
export function dayChoices(today: string, count = 60): string[] {
  return Array.from({ length: count + 1 }, (_, i) => shiftDay(today, -i));
}

/** "Today" / "Yesterday" for the two dates that have a word, else null. */
export function dayWordKey(date: string, today: string): 'closingHistory.today' | 'closingHistory.yesterday' | null {
  if (date === today) return 'closingHistory.today';
  if (date === shiftDay(today, -1)) return 'closingHistory.yesterday';
  return null;
}
