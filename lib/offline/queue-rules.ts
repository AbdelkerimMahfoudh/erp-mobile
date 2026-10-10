import { mayQueue } from './policy.ts';

/**
 * The rules a queued submission obeys (Milestone J).
 *
 * Pure and dependency-free, so every one of them can be tested without a
 * device, a network or a clock. The engine that actually sends things is a thin
 * shell around this file.
 *
 * The rule that shapes the rest: **never silently change a payload to make it
 * pass, and never retry forever.** A submission the server refused on its
 * merits is not a network problem, and hiding it behind another attempt turns a
 * question somebody could have answered into a record that quietly never
 * existed.
 */

export type QueueState =
  | 'draft'
  | 'waiting_for_connection'
  | 'sending'
  | 'synced'
  | 'needs_attention'
  | 'cancelled'
  /*
    An agent exchange's own three (D161), beside Milestone J's: `uncertain` — an attempt may have reached the
    server and its answer was lost, so the status lookup decides, never a blind resend; `rejected_resubmit` — not
    recorded, and the person can fix it (send again, review, edit); `rejected_reenter` — not recorded here, and
    someone else has to enter it (a Manager, someone allowed, the right branch). Other kinds never take them.
  */
  | 'uncertain'
  | 'rejected_resubmit'
  | 'rejected_reenter';

/** Every state a stored item may be in: anything else in a file is refused as foreign, never shown as pending. */
export const QUEUE_STATES: readonly QueueState[] = [
  'draft',
  'waiting_for_connection',
  'sending',
  'synced',
  'needs_attention',
  'cancelled',
  'uncertain',
  'rejected_resubmit',
  'rejected_reenter',
] as const;

/**
 * Deliberately no `failed`.
 *
 * A conflict is not a failure — it is a question for a person: the amount
 * changed, the permission went away, the branch moved. Calling it "failed"
 * invites an app to retry it, and invites an employee to ignore it.
 */
export const TERMINAL_STATES: readonly QueueState[] = ['synced', 'cancelled'] as const;

export interface QueueItem {
  id: string;
  kind: string;
  /** Reused on every attempt. A new one would create a second record. */
  clientUuid: string;
  /** Who and where. Checked again at replay, never trusted from the file. */
  companyId: string;
  branchId: string | null;
  userId: string;
  /** Bumped when the shape of `payload` changes between app versions. */
  payloadVersion: number;
  payload: unknown;
  state: QueueState;
  createdAt: number;
  lastAttemptAt: number | null;
  attempts: number;
  /** Plain words, safe to show on a list. Never the raw payload. */
  summary: string;
  lastError: ClassifiedError | null;
  /**
   * What the server answered when it accepted the item, reduced to what a
   * screen shows — for an agent exchange, the record's id, the server's instant
   * and business day (D155): a queued exchange is never shown with a time the
   * server did not give it.
   */
  result?: Record<string, string | number> | null;
  /**
   * An agent exchange refused because another exchange holds its key (D161): that record as the status lookup
   * showed it — masked, never the full number — so the person can hand both to a Manager.
   */
  serverRecord?: Record<string, string | number> | null;
  /**
   * Read only to bring an older build's file forward (D161): an agent exchange that may have been recorded became
   * the `uncertain` state at load. Never written.
   */
  mayBeRecorded?: boolean;
}

export type ErrorKind =
  | 'no_network'
  | 'api_unreachable'
  | 'timeout_uncertain'
  | 'session_expired'
  | 'permission_denied'
  | 'entitlement_blocked'
  | 'validation'
  | 'conflict'
  | 'server_error';

export interface ClassifiedError {
  kind: ErrorKind;
  message: string;
  status?: number;
  /** The server's machine code (`stale_configuration`, `store_closed` …), so a screen can say it in its own words. */
  code?: string;
}

/**
 * Which failures are worth another attempt.
 *
 * Only the ones where nothing was decided. A 4xx means the server read the
 * request and said no; sending it again unchanged produces the same no, and
 * every attempt costs the shop a little more trust in the queue.
 */
export function isTransient(kind: ErrorKind): boolean {
  return kind === 'no_network' || kind === 'api_unreachable' || kind === 'server_error' || kind === 'timeout_uncertain';
}

/**
 * Where an error leaves an item.
 *
 * A timeout is the interesting one: the request may well have succeeded, so it
 * goes back to waiting and is retried **with the same client UUID**. That is
 * precisely what idempotency is for — the retry either creates the record or
 * finds the one the lost response was about, and either way there is one.
 */
export function nextStateAfterError(e: ClassifiedError): QueueState {
  return isTransient(e.kind) ? 'waiting_for_connection' : 'needs_attention';
}

/** Attempts are bounded. Past this an item waits for a person, not a timer. */
export const MAX_ATTEMPTS = 8;

/**
 * Bounded exponential backoff with a ceiling, in milliseconds.
 *
 * Roughly 2s, 4s, 8s … capped at five minutes. The cap matters more than the
 * curve: a shop that reconnects after an hour should not then wait an hour more
 * because the delay kept doubling while nobody was watching.
 */
export function backoffMs(attempts: number): number {
  const base = 2000 * 2 ** Math.max(0, attempts - 1);
  return Math.min(base, 5 * 60_000);
}

export function shouldRetry(item: QueueItem, now: number): boolean {
  if (item.state !== 'waiting_for_connection') return false;
  if (item.attempts >= MAX_ATTEMPTS) return false;
  if (item.lastAttemptAt === null) return true;
  return now - item.lastAttemptAt >= backoffMs(item.attempts);
}

/**
 * Whether an item still belongs to the person and place now signed in.
 *
 * Checked at replay rather than only at enqueue, because everything about the
 * session can change while an item waits: a different user signs in on the
 * shared counter phone, somebody switches branch, a role is revoked. Replaying
 * under the wrong one of those would attribute a shop's money to the wrong
 * person, or send it to the wrong branch entirely.
 */
export function belongsToSession(
  item: QueueItem,
  session: { companyId: string; branchId: string | null; userId: string },
): boolean {
  return (
    item.companyId === session.companyId &&
    item.branchId === session.branchId &&
    item.userId === session.userId
  );
}

export type ReplayDecision =
  | { send: true }
  | { send: false; reason: 'not_queueable' | 'wrong_session' | 'not_waiting' | 'backing_off' | 'exhausted' };

/**
 * The single gate every item passes through before anything is sent.
 *
 * One function, so no caller can accidentally check three of the four rules.
 */
export function decideReplay(
  item: QueueItem,
  session: { companyId: string; branchId: string | null; userId: string },
  now: number,
): ReplayDecision {
  // Re-checked even though enqueue checked it: a build that reclassified an
  // operation must not replay what an older build was allowed to store.
  if (!mayQueue(item.kind)) return { send: false, reason: 'not_queueable' };
  if (!belongsToSession(item, session)) return { send: false, reason: 'wrong_session' };
  if (item.state !== 'waiting_for_connection') return { send: false, reason: 'not_waiting' };
  if (item.attempts >= MAX_ATTEMPTS) return { send: false, reason: 'exhausted' };
  if (!shouldRetry(item, now)) return { send: false, reason: 'backing_off' };
  return { send: true };
}

/**
 * Order of sending.
 *
 * FIFO by creation within a dependency group, so two payment reports against
 * the same loan reach the server in the order the shop made them. Different
 * groups are independent and one stuck item must never block them — a queue
 * where one bad expense freezes every notification is a queue people turn off.
 */
export function dependencyGroup(item: QueueItem): string {
  // Each exchange at the agent counter is its own subject (D155): one that needs a person must never hold back the
  // next customer's, and no exchange depends on another's outcome.
  if (item.kind === 'agent.exchange.record') return `${item.kind}:${item.clientUuid}`;
  return `${item.kind}:${groupSubject(item)}`;
}

function groupSubject(item: QueueItem): string {
  const p = item.payload as Record<string, unknown> | null;
  const subject = p && typeof p === 'object' ? (p.loanId ?? p.consignmentId ?? p.id) : null;
  return typeof subject === 'string' ? subject : 'none';
}

export function orderForReplay(items: readonly QueueItem[]): QueueItem[] {
  return [...items].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/** States that hold the rest of their group back: on their way, or waiting for a person or a lookup. */
const UNRESOLVED: readonly QueueState[] = ['sending', 'needs_attention', 'uncertain', 'rejected_resubmit', 'rejected_reenter'];

/**
 * The next item to send per group, oldest first.
 *
 * Returns at most one per group: a later report must not overtake an earlier
 * one against the same subject, and must not be sent while the earlier one is
 * unresolved.
 */
export function nextSendable(
  items: readonly QueueItem[],
  session: { companyId: string; branchId: string | null; userId: string },
  now: number,
): QueueItem[] {
  const out: QueueItem[] = [];
  const blocked = new Set<string>();
  for (const item of orderForReplay(items)) {
    const group = dependencyGroup(item);
    if (blocked.has(group)) continue;
    // Anything unresolved in this group holds the rest of the group back,
    // whether it is mid-flight or waiting for somebody to look at it.
    if (UNRESOLVED.includes(item.state)) {
      blocked.add(group);
      continue;
    }
    if (decideReplay(item, session, now).send) {
      out.push(item);
      blocked.add(group);
    }
  }
  return out;
}

/**
 * Cancelling is only honest while nothing has been recorded: a draft, an item waiting to be sent (for an exchange,
 * every answer so far proved nothing was recorded — a lost answer makes it `uncertain`), or one the server refused
 * on its merits. An exchange that may be recorded, or must be entered elsewhere, is never "cancelled": it is
 * checked again, or removed.
 */
export function mayCancel(item: QueueItem): boolean {
  if (item.kind === 'agent.exchange.record') {
    return item.state === 'draft' || item.state === 'waiting_for_connection' || item.state === 'rejected_resubmit';
  }
  return item.state === 'draft' || item.state === 'waiting_for_connection' || item.state === 'needs_attention';
}

/**
 * Removing an exchange from this phone (D161): one that may be recorded (the server's list is the record of what
 * happened), or one the server refused — never while it is on its way, never once it is finished.
 */
export function mayRemove(item: QueueItem): boolean {
  return (
    item.kind === 'agent.exchange.record' &&
    (item.state === 'uncertain' || item.state === 'rejected_resubmit' || item.state === 'rejected_reenter' || item.state === 'needs_attention')
  );
}

/**
 * What the shop is told, per state.
 *
 * Never green until the server has agreed. `synced` is the only state that has
 * earned a success colour, and `needs_attention` is deliberately not red-as-in-
 * broken: something needs a decision, not a repair.
 */
export function toneFor(state: QueueState): 'neutral' | 'info' | 'warning' | 'success' {
  switch (state) {
    case 'synced':
      return 'success';
    case 'needs_attention':
    case 'uncertain':
    case 'rejected_resubmit':
    case 'rejected_reenter':
      return 'warning';
    case 'sending':
    case 'waiting_for_connection':
      return 'info';
    default:
      return 'neutral';
  }
}
