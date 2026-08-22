import type { Entitlement } from '../entitlement';

/**
 * What More is allowed to say about sync and subscription (milestone N).
 *
 * Both decisions live here rather than inside the screen so they can be tested
 * without a renderer, and so the rules are readable in one place. Both are
 * about **when to speak**, never about what is true: the queue owns its states
 * and the server owns entitlement.
 *
 * Type-only imports, so this module stays loadable by a plain `node` test.
 */

/** The only queue states More reacts to. Mirrors `lib/offline/queue`. */
export interface QueueEntry {
  readonly state: string;
}

export type SyncNoticeKind = 'none' | 'waiting' | 'attention';

export interface SyncNotice {
  readonly kind: SyncNoticeKind;
  readonly count: number;
}

/**
 * Whether the landing screen should raise the queue, and how loudly.
 *
 * Two states kept apart on purpose. Work merely waiting for a connection will
 * resolve on its own and deserves a quiet line; work that needs a person will
 * not move until somebody opens it. Adding those into one number is exactly how
 * a conflict sits unnoticed for a week behind a reassuring "3 waiting".
 *
 * Attention wins when both exist: the queue draining does not clear a conflict.
 */
export function syncNotice(items: readonly QueueEntry[]): SyncNotice {
  const attention = items.filter((i) => i.state === 'needs_attention').length;
  if (attention > 0) return { kind: 'attention', count: attention };

  const waiting = items.filter(
    (i) => i.state === 'waiting_for_connection' || i.state === 'sending',
  ).length;
  if (waiting > 0) return { kind: 'waiting', count: waiting };

  // Nothing queued: the notice disappears entirely. The Sync center itself
  // stays reachable through Account & security, so its history can still be
  // inspected when all is well.
  return { kind: 'none', count: 0 };
}

export type SubscriptionNoticeKind = 'none' | 'approaching' | 'grace' | 'expired' | 'over_limit';

/**
 * How many days of an active subscription still count as worth interrupting for.
 *
 * The ONLY client-side number in this file, and it decides nothing about
 * entitlement — `daysRemaining` is computed by the server, and this just says
 * when a countdown it already produced is worth putting on the landing screen.
 */
export const SUBSCRIPTION_NOTICE_DAYS = 7;

/**
 * Whether Subscription should be surfaced outside Team & business.
 *
 * During normal operation it stays in its hub like any other destination. It is
 * lifted out only in the four states the server reports as needing attention,
 * and every one of those comes from the server's own fields — nothing here
 * derives a state, a remaining grace or whether writes are allowed.
 *
 * Order matters: expired outranks over-limit, because a shop that cannot write
 * has a different problem from one that has too many staff.
 */
export function subscriptionNotice(entitlement: Entitlement | undefined): SubscriptionNoticeKind {
  if (!entitlement) return 'none';
  if (entitlement.state === 'expired') return 'expired';
  if (entitlement.state === 'grace') return 'grace';
  if (entitlement.overLimit) return 'over_limit';
  if (
    entitlement.state === 'active' &&
    entitlement.daysRemaining !== null &&
    entitlement.daysRemaining <= SUBSCRIPTION_NOTICE_DAYS
  ) {
    return 'approaching';
  }
  // Complimentary and comfortably-active shops are told nothing. A banner that
  // is always there is a banner nobody reads.
  return 'none';
}
