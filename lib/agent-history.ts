import { toAsciiDigits } from './price-input.ts';
import type { AgentDirection, LegAccount, LegDirection, LegKind } from './agent-rules.ts';
import type { QueueItem } from './offline/queue-rules.ts';

/**
 * The exchanges list and one exchange (docs/73 §5, D157), as pure rules:
 * the periods offered, the filters sent, the masked search, which queued
 * exchanges head the list, and the words of each leg.
 *
 * Every filter goes to the server (`GET agent/transactions`), as every list in
 * this app does: a screen that narrowed only its loaded pages would answer
 * "nothing matches" for an exchange two pages down — and somebody is usually
 * standing at the counter asking about exactly that one.
 *
 *   node lib/agent-history.test.ts
 */

export type HistoryPeriod = 'today' | 'yesterday' | 'week' | 'month' | 'all';
export const HISTORY_PERIODS: readonly HistoryPeriod[] = ['today', 'yesterday', 'week', 'month', 'all'];

/** A business date moved by whole days, in the calendar — never through a clock or a time zone. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/**
 * The business dates a period covers, ending on the branch's business day (the
 * server's, as the positions report it): today; yesterday; the seven days to
 * today; the month so far; or every day.
 */
export function periodRange(period: HistoryPeriod, businessDate: string): { from?: string; to?: string } {
  switch (period) {
    case 'today':
      return { from: businessDate, to: businessDate };
    case 'yesterday': {
      const day = addDays(businessDate, -1);
      return { from: day, to: day };
    }
    case 'week':
      return { from: addDays(businessDate, -6), to: businessDate };
    case 'month':
      return { from: `${businessDate.slice(0, 7)}-01`, to: businessDate };
    default:
      return {};
  }
}

/** What the search box searches: the last four digits of the number (masked), or a provider reference (exact). */
export type SearchMode = 'number' | 'reference';

/**
 * The search sent to the server, or nothing yet. The number is searched by its
 * last four digits only — never more of it, so the list stays masked; Arabic
 * digits read as the same digits. A reference is matched exactly.
 */
export function searchFilter(mode: SearchMode, typed: string): { last4?: string; reference?: string } | null {
  const text = typed.trim();
  if (!text) return {};
  if (mode === 'number') {
    const digits = toAsciiDigits(text).replace(/[\s-]/g, '');
    return /^\d{4}$/.test(digits) ? { last4: digits } : null;
  }
  return text.length <= 120 ? { reference: text } : null;
}

/**
 * The phone's own exchanges that head the list: the ones the server has not
 * accepted yet — Pending synchronization, or waiting for a person — newest
 * first. Once the server accepts one it is in the server's list, never twice.
 */
export function queuedFirst(items: readonly QueueItem[], branchId: string | null): QueueItem[] {
  return items
    .filter((i) => i.kind === 'agent.exchange.record' && i.branchId === branchId && i.state !== 'synced' && i.state !== 'cancelled')
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** The i18n key of a leg, in words: which account, which way — the drawer, a float, the held commission, the outside. */
export function legWordsKey(leg: { account: LegAccount; direction: LegDirection }): string {
  return `agent.leg.${leg.account}.${leg.direction}`;
}

/** The i18n key of a leg's kind: the principal, the commission, a reversal's counter-leg, a rebalancing. */
export function legKindKey(kind: LegKind): string {
  return `agent.leg.kind.${kind}`;
}

/** An exchange's direction, in the words of a list row. */
export function directionRowKey(direction: AgentDirection): string {
  return `agent.row.${direction}`;
}

/**
 * The legs of one exchange split in two: what it moved when it was recorded,
 * and — once reversed — the counter-legs, one per leg, the other way (A7).
 */
export function splitLegs<T extends { kind: LegKind }>(legs: readonly T[]): { original: T[]; reversal: T[] } {
  return { original: legs.filter((l) => l.kind !== 'reversal'), reversal: legs.filter((l) => l.kind === 'reversal') };
}
