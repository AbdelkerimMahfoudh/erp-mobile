/**
 * What More is allowed to say about sync (milestone N).
 *
 * The decision lives here rather than inside the screen so it can be tested
 * without a renderer. It is about **when to speak**, never about what is true:
 * the queue owns its states. What the tabs say about business access is
 * decided in `lib/access.ts` (2026-10-05).
 *
 * No imports, so this module stays loadable by a plain `node` test.
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
  // A refused exchange (D161) waits for a person as surely as a conflict does: it is never "waiting".
  const attention = items.filter(
    (i) => i.state === 'needs_attention' || i.state === 'rejected_resubmit' || i.state === 'rejected_reenter',
  ).length;
  if (attention > 0) return { kind: 'attention', count: attention };

  // An uncertain exchange resolves itself once the server answers its lookup: quiet, like anything waiting.
  const waiting = items.filter(
    (i) => i.state === 'waiting_for_connection' || i.state === 'sending' || i.state === 'uncertain',
  ).length;
  if (waiting > 0) return { kind: 'waiting', count: waiting };

  // Nothing queued: the notice disappears entirely. The Sync center itself
  // stays reachable through Account & security, so its history can still be
  // inspected when all is well.
  return { kind: 'none', count: 0 };
}
